import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

loadEnvFile(".env");
loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const redirectTo = process.env.ANALYST_INVITE_REDIRECT_TO;

const analysts = [
  { name: "JHENNIPHER MATA", email: "jhenniphermata@meirelesefreitas.adv.br" },
  { name: "JULIANO RAMOS", email: "julianoramos@meirelesefreitas.adv.br" },
];

if (!url || !serviceRoleKey) {
  fail("Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local ou no ambiente.");
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const report = {
  invited: [],
  updated: [],
  profiles: [],
};

for (const analyst of analysts) {
  const email = analyst.email.toLowerCase();
  const existingUser = await findUserByEmail(admin, email);
  let user = existingUser;

  if (existingUser) {
    const { data, error } = await admin.auth.admin.updateUserById(existingUser.id, {
      user_metadata: { full_name: analyst.name },
    });

    if (error || !data.user) fail(error?.message || `Nao foi possivel atualizar ${email}.`);
    user = data.user;
    report.updated.push(email);
  } else {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: analyst.name },
      ...(redirectTo ? { redirectTo } : {}),
    });

    if (error || !data.user) fail(error?.message || `Nao foi possivel convidar ${email}.`);
    user = data.user;
    report.invited.push(email);
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: user.id,
    email,
    full_name: analyst.name,
    role: "analista",
    active: true,
  });

  if (profileError) fail(profileError.message);
  report.profiles.push(email);
}

console.log(JSON.stringify(report, null, 2));

async function findUserByEmail(client, targetEmail) {
  const normalized = targetEmail.toLowerCase();

  for (let page = 1; page <= 20; page += 1) {
    const {
      data: { users },
      error,
    } = await client.auth.admin.listUsers({ page, perPage: 1000 });

    if (error) fail(error.message);
    const found = users.find((item) => item.email?.toLowerCase() === normalized);
    if (found) return found;
    if (users.length < 1000) return null;
  }

  return null;
}

function loadEnvFile(fileName) {
  const filePath = resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
