import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

loadEnvFile(".env");
loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const defaultPassword = process.argv[2] ?? process.env.INITIAL_OPERATOR_PASSWORD;

const team = [
  { name: "ARYANNE", email: "aryanne.kesya@meirelesefreitas.adv.br", role: "operador" },
  { name: "CAROL", email: "paulacarolini@meirelesefreitas.adv.br", role: "operador" },
  { name: "EDMILSON", email: "edmilsonbrunno@meirelesefreitas.adv.br", role: "operador" },
  { name: "ISABEL", email: "mariacelestino@meirelesefreitas.adv.br", role: "gestor" },
  { name: "JULIA", email: "juliaemilia@meirelesefreitas.adv.br", role: "operador" },
  { name: "LUCAS", email: "lucascosta@meirelesefreitas.adv.br", role: "operador" },
  { name: "WELLINGTON", email: "wellingtonlima@meirelesefreitas.adv.br", role: "operador" },
  { name: "ANTHONY", email: "anthony.santos@meirelesefreitas.adv.br", role: "operador" },
  { name: "EDUARDA", email: "mariasousa@meirelesefreitas.adv.br", role: "operador" },
  { name: "ELAINE", email: "elaine.cruz@meirelesefreitas.adv.br", role: "operador" },
  { name: "ISADORA", email: "isadoranascimento@meirelesefreitas.adv.br", role: "operador" },
];

const responsibleAliases = [
  { from: "ANTONY", to: "ANTHONY" },
  { from: "J\u00daLIA", to: "JULIA" },
];

if (!url || !serviceRoleKey) {
  fail("Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local ou no ambiente.");
}

if (!defaultPassword || defaultPassword.length < 8) {
  fail('Informe uma senha temporaria com pelo menos 8 caracteres: npm run seed:team -- "senha-temporaria"');
}

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const report = {
  users: {
    created: [],
    updated: [],
  },
  profiles: {
    upserted: [],
  },
  aliases: [],
};

for (const operator of team) {
  const email = operator.email.toLowerCase();
  const existingUser = await findUserByEmail(admin, email);
  let user = existingUser;

  if (existingUser) {
    const { data, error } = await admin.auth.admin.updateUserById(existingUser.id, {
      email,
      password: defaultPassword,
      email_confirm: true,
      user_metadata: { full_name: operator.name },
    });

    if (error || !data.user) fail(error?.message || `Nao foi possivel atualizar ${email}.`);
    user = data.user;
    report.users.updated.push(email);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: defaultPassword,
      email_confirm: true,
      user_metadata: { full_name: operator.name },
    });

    if (error || !data.user) fail(error?.message || `Nao foi possivel criar ${email}.`);
    user = data.user;
    report.users.created.push(email);
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: user.id,
    email,
    full_name: operator.name,
    role: operator.role ?? "operador",
    active: true,
  });

  if (profileError) fail(profileError.message);
  report.profiles.upserted.push(email);
}

for (const alias of responsibleAliases) {
  const result = {
    from: alias.from,
    to: alias.to,
    responsavel_cumprimento: await replaceResponsibleAlias(admin, "responsavel_cumprimento", alias.from, alias.to),
    responsavel_qualidade: await replaceResponsibleAlias(admin, "responsavel_qualidade", alias.from, alias.to),
  };
  report.aliases.push(result);
}

console.log(JSON.stringify(report, null, 2));

async function replaceResponsibleAlias(client, column, from, to) {
  const { count, error: countError } = await client
    .from("sentences")
    .select("id", { count: "exact", head: true })
    .eq(column, from);

  if (countError) fail(countError.message);
  if (!count) return 0;

  const { error: updateError } = await client
    .from("sentences")
    .update({ [column]: to })
    .eq(column, from);

  if (updateError) fail(updateError.message);
  return count;
}

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
