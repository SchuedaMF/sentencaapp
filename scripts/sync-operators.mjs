import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

loadEnvFile(".env");
loadEnvFile(".env.local");

const [, , inputPath] = process.argv;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!inputPath) {
  fail("Informe o arquivo: npm run sync:operators -- caminho/usuarios.xlsx");
}

if (!url || !serviceRoleKey) {
  fail("Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local ou no ambiente.");
}

const workbookPath = resolve(inputPath);
if (!existsSync(workbookPath)) fail(`Arquivo nao encontrado: ${workbookPath}`);

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const operators = readOperators(workbookPath);
if (operators.length === 0) fail("Nenhum operador valido encontrado. Use colunas email, nome e opcionalmente senha_temporaria.");

const responsibleCatalog = await fetchResponsibleCatalog(admin);
const report = {
  file: basename(workbookPath),
  totalRows: operators.length,
  created: [],
  updated: [],
  generatedPasswords: [],
  unmatchedNames: buildUnmatchedReport(operators, responsibleCatalog),
};

for (const operator of operators) {
  const existingUser = await findUserByEmail(admin, operator.email);
  let user = existingUser;
  const generatedPassword = operator.password ? null : generatePassword();
  const password = operator.password ?? generatedPassword;

  if (existingUser) {
    const updatePayload = {
      email_confirm: true,
      user_metadata: { full_name: operator.name },
    };
    if (operator.password) updatePayload.password = operator.password;

    const { data, error } = await admin.auth.admin.updateUserById(existingUser.id, updatePayload);
    if (error || !data.user) fail(error?.message || `Nao foi possivel atualizar ${operator.email}.`);
    user = data.user;
    report.updated.push(operator.email);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: operator.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: operator.name },
    });
    if (error || !data.user) fail(error?.message || `Nao foi possivel criar ${operator.email}.`);
    user = data.user;
    report.created.push(operator.email);
    if (generatedPassword) report.generatedPasswords.push({ email: operator.email, password: generatedPassword });
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: user.id,
    email: operator.email,
    full_name: operator.name,
    role: "operador",
    active: true,
  });

  if (profileError) fail(profileError.message);
}

console.log(JSON.stringify(report, null, 2));

function readOperators(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: false });
  const seenEmails = new Set();
  const operators = [];

  for (const rawRow of rawRows) {
    const row = normalizeRow(rawRow);
    const email = String(row.email ?? "").trim().toLowerCase();
    const name = normalizeOperatorName(row.nome ?? row.name ?? row.full_name);
    const password = nullableText(row.senha_temporaria ?? row.senha ?? row.password);

    if (!email || !name || seenEmails.has(email)) continue;
    seenEmails.add(email);
    operators.push({ email, name, password });
  }

  return operators;
}

function normalizeRow(rawRow) {
  const row = {};
  for (const [key, value] of Object.entries(rawRow)) {
    row[normalizeHeader(key)] = value;
  }
  return row;
}

function normalizeHeader(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function normalizeOperatorName(value) {
  return nullableText(value)?.replace(/\s+/g, " ") ?? "";
}

function nullableText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\u00a0/g, " ").trim();
  return text === "" ? null : text;
}

async function fetchResponsibleCatalog(client) {
  const exact = new Set();
  const normalized = new Map();
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from("sentences")
      .select("id,responsavel_cumprimento,responsavel_qualidade")
      .order("id")
      .range(from, from + pageSize - 1);

    if (error) fail(error.message);

    for (const row of data ?? []) {
      for (const name of [row.responsavel_cumprimento, row.responsavel_qualidade]) {
        const cleaned = normalizeOperatorName(name);
        if (!cleaned) continue;
        exact.add(cleaned);
        const key = normalizeResponsibleForCompare(cleaned);
        const suggestions = normalized.get(key) ?? new Set();
        suggestions.add(cleaned);
        normalized.set(key, suggestions);
      }
    }

    if (!data || data.length < pageSize) break;
  }

  return { exact, normalized };
}

function buildUnmatchedReport(operators, catalog) {
  return operators
    .filter((operator) => !catalog.exact.has(operator.name))
    .map((operator) => {
      const suggestions = catalog.normalized.get(normalizeResponsibleForCompare(operator.name));
      return {
        email: operator.email,
        name: operator.name,
        suggestions: suggestions ? [...suggestions] : [],
      };
    });
}

function normalizeResponsibleForCompare(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
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

function generatePassword() {
  return `Op-${randomBytes(9).toString("base64url")}`;
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
