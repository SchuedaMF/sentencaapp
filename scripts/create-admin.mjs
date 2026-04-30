import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

loadEnvFile(".env");
loadEnvFile(".env.local");

const [, , emailArg, passwordArg, nameArg] = process.argv;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = emailArg || process.env.INITIAL_ADMIN_EMAIL;
const password = passwordArg || process.env.INITIAL_ADMIN_PASSWORD;
const fullName = nameArg || process.env.INITIAL_ADMIN_NAME || email?.split("@")[0] || "Admin";

if (!url || !serviceRoleKey) {
  fail("Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local ou no ambiente.");
}

if (!email || !password) {
  fail('Informe INITIAL_ADMIN_EMAIL e INITIAL_ADMIN_PASSWORD, ou rode: npm run seed:admin -- email@dominio.com senha-temporaria "Nome".');
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const existingUser = await findUserByEmail(admin, email);
let user = existingUser;

if (user) {
  const { data, error } = await admin.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) fail(error?.message || "Não foi possível atualizar o usuário admin.");
  user = data.user;
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) fail(error?.message || "Não foi possível criar o usuário admin.");
  user = data.user;
}

const { error: profileError } = await admin.from("profiles").upsert({
  id: user.id,
  email,
  full_name: fullName,
  role: "admin",
  active: true,
});

if (profileError) fail(profileError.message);

console.log(`Admin pronto: ${email}`);

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
