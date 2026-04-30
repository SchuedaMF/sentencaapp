import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const defaultOutputPath = path.join(rootDir, "outputs", "salesforce-orders-import-preview.json");
const defaultDownloadsPrefix = "#A Relatorio BCC - Todas os Casos- 01-01-2026";
const cnjPattern = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g;
const openCaseStatuses = new Set(["EM PROCESSO", "EM PROGRESSO", "SUSPENSO"]);
const closedCaseStatuses = new Set(["FECHADO", "CANCELADO"]);

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/\s+/g, " ");
}

function nullableText(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const text = String(value).replace(/\u00a0/g, " ").trim();
  return text === "" ? null : text;
}

function rawValue(value) {
  if (value === undefined) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return value;
}

function parseArgs(argv) {
  const options = {
    workbookPath: null,
    outputPath: defaultOutputPath,
    importMode: false,
    batchSize: 500,
  };

  for (const arg of argv) {
    if (arg === "--import") {
      options.importMode = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.importMode = false;
      continue;
    }
    if (arg.startsWith("--output=")) {
      options.outputPath = path.resolve(arg.slice("--output=".length));
      continue;
    }
    if (arg.startsWith("--batch-size=")) {
      const value = Number(arg.slice("--batch-size=".length));
      if (Number.isInteger(value) && value > 0) options.batchSize = value;
      continue;
    }
    if (!arg.startsWith("--")) options.workbookPath = path.resolve(arg);
  }

  return options;
}

async function findDefaultWorkbook() {
  const downloadsDir = path.join(process.env.USERPROFILE ?? "", "Downloads");
  if (!downloadsDir.trim()) return null;

  const entries = await fs.readdir(downloadsDir, { withFileTypes: true }).catch(() => []);
  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(defaultDownloadsPrefix) && /\.xlsx$/i.test(entry.name))
    .map((entry) => path.join(downloadsDir, entry.name));

  if (candidates.length === 0) return null;

  const stats = await Promise.all(candidates.map(async (candidate) => ({ candidate, stat: await fs.stat(candidate) })));
  stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  return stats[0].candidate;
}

function loadEnvFile(filePath) {
  return fs.readFile(filePath, "utf8")
    .then((content) => {
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
        const [key, ...rest] = trimmed.split("=");
        if (!key || process.env[key]) continue;
        let value = rest.join("=");
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    })
    .catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
}

function readSalesforceSheet(workbookPath) {
  const workbook = XLSX.readFile(workbookPath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Nenhuma aba encontrada na planilha Salesforce.");

  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
    raw: true,
    blankrows: false,
  });
  const headerIndex = matrix.findIndex(isSalesforceHeaderRow);
  if (headerIndex < 0) throw new Error("Cabecalho Salesforce nao encontrado. Procure pelas colunas Assunto e Numero da ordem.");

  const headers = matrix[headerIndex].map((header) => nullableText(header) ?? "");
  const uniqueHeaders = makeUniqueHeaders(headers);
  const columnIndexes = resolveColumnIndexes(headers);
  const rows = matrix.slice(headerIndex + 1)
    .map((values, index) => ({ values, rowNumber: headerIndex + index + 2 }))
    .filter(({ values }) => values.some((value) => value !== null && value !== undefined && String(value).trim() !== ""));

  return {
    sheetName,
    headerRowNumber: headerIndex + 1,
    headers,
    uniqueHeaders,
    columnIndexes,
    rows,
  };
}

function isSalesforceHeaderRow(row) {
  const headers = row.map(normalizeHeader);
  return headers.includes("ASSUNTO")
    && headers.includes("NUMERO DA ORDEM")
    && headers.includes("NUMERO DO CASO");
}

function makeUniqueHeaders(headers) {
  const counts = new Map();
  return headers.map((header, index) => {
    const base = header || `COL_${index + 1}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base}__${count}`;
  });
}

function resolveColumnIndexes(headers) {
  const normalized = headers.map(normalizeHeader);
  const statusIndexes = normalized
    .map((header, index) => ({ header, index }))
    .filter((item) => item.header === "STATUS")
    .map((item) => item.index);
  const observationIndexes = normalized
    .map((header, index) => ({ header, index }))
    .filter((item) => item.header === "OBSERVACOES")
    .map((item) => item.index);

  return {
    ownerName: normalized.indexOf("PROPRIETARIO DO CASO: NOME COMPLETO"),
    supplyPointNumber: normalized.indexOf("NUMERO DO PONTO DE FORNECIMENTO"),
    subject: normalized.indexOf("ASSUNTO"),
    salesforceCaseNumber: normalized.indexOf("NUMERO DO CASO"),
    caseStatus: statusIndexes[0] ?? -1,
    orderNumber: normalized.indexOf("NUMERO DA ORDEM"),
    orderState: normalized.indexOf("ESTADO DA ORDEM"),
    synergiaOrderNumber: normalized.indexOf("NUMERO ORDEM SYNERGIA"),
    openedAt: normalized.indexOf("DATA/HORA DE ABERTURA"),
    createdOn: normalized.indexOf("DATA DE CRIACAO"),
    reason: normalized.indexOf("MOTIVO"),
    subreason: normalized.indexOf("SUBMOTIVO"),
    orderStatus: statusIndexes[1] ?? -1,
    originChannel: normalized.indexOf("CANAL DE ORIGEM"),
    municipality: normalized.indexOf("MUNICIPALIDADE"),
    caseObservations: normalized.indexOf("OBSERVACOES DO CASO"),
    companyClientId: normalized.indexOf("COMPANHIA ID CLIENTE"),
    observationsPrefixed: observationIndexes[0] ?? -1,
    observations: observationIndexes[1] ?? -1,
    segmentType: normalized.indexOf("TIPO DE SEGMENTO"),
    primaryContactName: normalized.indexOf("CONTATO PRINCIPAL: NOME COMPLETO"),
  };
}

function valueAt(values, index) {
  return index >= 0 ? values[index] ?? null : null;
}

function buildRecord(row, uniqueHeaders, columnIndexes) {
  const rawImportPayload = Object.fromEntries(uniqueHeaders.map((header, index) => [header, rawValue(row.values[index] ?? null)]));
  const extraction = extractProcess(row.values, columnIndexes);
  const caseStatus = nullableText(valueAt(row.values, columnIndexes.caseStatus));
  const statusBucket = caseStatusBucket(caseStatus);
  const orderNumber = nullableText(valueAt(row.values, columnIndexes.orderNumber));
  const synergiaOrderNumber = nullableText(valueAt(row.values, columnIndexes.synergiaOrderNumber));
  const salesforceCaseNumber = nullableText(valueAt(row.values, columnIndexes.salesforceCaseNumber));

  return {
    import_row_number: row.rowNumber,
    processo: extraction.processo,
    processo_source: extraction.source,
    owner_name: nullableText(valueAt(row.values, columnIndexes.ownerName)),
    supply_point_number: nullableText(valueAt(row.values, columnIndexes.supplyPointNumber)),
    subject: nullableText(valueAt(row.values, columnIndexes.subject)),
    salesforce_case_number: salesforceCaseNumber,
    case_status: caseStatus,
    status_bucket: statusBucket,
    is_open: statusBucket === "open",
    order_number: orderNumber,
    order_state: nullableText(valueAt(row.values, columnIndexes.orderState)),
    synergia_order_number: synergiaOrderNumber,
    order_status: nullableText(valueAt(row.values, columnIndexes.orderStatus)),
    order_key: orderNumber ?? synergiaOrderNumber ?? salesforceCaseNumber,
    opened_at: parseDateTime(valueAt(row.values, columnIndexes.openedAt)),
    created_on: parseDate(valueAt(row.values, columnIndexes.createdOn)),
    reason: nullableText(valueAt(row.values, columnIndexes.reason)),
    subreason: nullableText(valueAt(row.values, columnIndexes.subreason)),
    origin_channel: nullableText(valueAt(row.values, columnIndexes.originChannel)),
    municipality: nullableText(valueAt(row.values, columnIndexes.municipality)),
    case_observations: nullableText(valueAt(row.values, columnIndexes.caseObservations)),
    company_client_id: nullableText(valueAt(row.values, columnIndexes.companyClientId)),
    observations_prefixed: nullableText(valueAt(row.values, columnIndexes.observationsPrefixed)),
    observations: nullableText(valueAt(row.values, columnIndexes.observations)),
    segment_type: nullableText(valueAt(row.values, columnIndexes.segmentType)),
    primary_contact_name: nullableText(valueAt(row.values, columnIndexes.primaryContactName)),
    raw_import_payload: rawImportPayload,
  };
}

function extractProcess(values, columnIndexes) {
  const candidates = [
    ["assunto", valueAt(values, columnIndexes.subject)],
    ["observacoes_do_caso", valueAt(values, columnIndexes.caseObservations)],
    ["observacoes_prefixed", valueAt(values, columnIndexes.observationsPrefixed)],
    ["observacoes", valueAt(values, columnIndexes.observations)],
  ];

  for (const [source, value] of candidates) {
    const match = String(value ?? "").match(cnjPattern)?.[0] ?? null;
    if (match) return { processo: match, source };
  }

  return { processo: null, source: null };
}

function caseStatusBucket(value) {
  const normalized = normalizeText(value);
  if (openCaseStatuses.has(normalized)) return "open";
  if (closedCaseStatuses.has(normalized)) return "closed";
  return "unknown";
}

function parseDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)).toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (match) {
    const year = normalizeYear(match[3]);
    return new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1]))).toISOString().slice(0, 10);
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseDateTime(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return formatBrtDateTime(parsed.y, parsed.m, parsed.d, parsed.H ?? 0, parsed.M ?? 0, parsed.S ?? 0);
  }

  const text = String(value).trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) {
    return formatBrtDateTime(
      normalizeYear(match[3]),
      Number(match[2]),
      Number(match[1]),
      Number(match[4] ?? 0),
      Number(match[5] ?? 0),
      Number(match[6] ?? 0),
    );
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeYear(value) {
  const year = Number(value);
  return year < 100 ? 2000 + year : year;
}

function formatBrtDateTime(year, month, day, hour, minute, second) {
  const date = [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
  const time = [
    String(hour).padStart(2, "0"),
    String(minute).padStart(2, "0"),
    String(second).padStart(2, "0"),
  ].join(":");
  return `${date}T${time}-03:00`;
}

function buildReport(records) {
  const processCounts = new Map();
  const orderCounts = new Map();
  const caseStatusCounts = new Map();
  const processoSourceCounts = new Map();

  for (const record of records) {
    increment(caseStatusCounts, record.case_status || "(vazio)");
    increment(processoSourceCounts, record.processo_source || "(nao extraido)");
    if (record.processo) increment(processCounts, record.processo);
    if (record.order_key) increment(orderCounts, record.order_key);
  }

  const openRows = records.filter((record) => record.status_bucket === "open").length;
  const closedRows = records.filter((record) => record.status_bucket === "closed").length;

  return {
    totalRows: records.length,
    rowsWithProcess: records.filter((record) => record.processo).length,
    rowsWithoutProcess: records.filter((record) => !record.processo).length,
    distinctProcesses: processCounts.size,
    openRows,
    closedRows,
    unknownStatusRows: records.length - openRows - closedRows,
    duplicateProcessos: [...processCounts.values()].filter((count) => count > 1).length,
    duplicateOrderKeys: [...orderCounts.values()].filter((count) => count > 1).length,
    caseStatusCounts: sortedObject(caseStatusCounts),
    processoSourceCounts: sortedObject(processoSourceCounts),
  };
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sortedObject(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

async function createSupabaseClient(required) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (!required) return null;
    throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para importar ordens Salesforce.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function appendMatchStats(supabase, report, records) {
  if (!supabase) return report;

  const sentences = await fetchAllSentences(supabase);
  const sentenceProcesses = new Set(sentences.map((sentence) => sentence.processo).filter(Boolean));
  const extractedProcesses = new Set(records.map((record) => record.processo).filter(Boolean));
  const matchedProcesses = [...extractedProcesses].filter((processo) => sentenceProcesses.has(processo));
  const rowsWithMatchedProcess = records.filter((record) => record.processo && sentenceProcesses.has(record.processo)).length;

  return {
    ...report,
    sentenceRows: sentences.length,
    matchedDistinctProcesses: matchedProcesses.length,
    rowsWithMatchedProcess,
    unmatchedDistinctProcesses: extractedProcesses.size - matchedProcesses.length,
  };
}

async function fetchAllSentences(supabase) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("sentences")
      .select("id,processo")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function countTable(supabase, tableName) {
  const { count, error } = await supabase.from(tableName).select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

async function refreshSalesforceOrderSummaries(supabase) {
  const { data, error } = await supabase.rpc("refresh_salesforce_order_process_summaries");
  if (error) throw error;
  return Number(data ?? 0);
}

async function importRecords(supabase, workbookPath, records, report, batchSize) {
  const beforeCounts = {
    sentences: await countTable(supabase, "sentences"),
    sentenceEvents: await countTable(supabase, "sentence_events"),
  };

  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .insert({
      file_name: path.basename(workbookPath),
      source_kind: "xlsx:salesforce_orders",
      total_rows: report.totalRows,
      imported_rows: records.length,
      warning_rows: report.rowsWithoutProcess + report.unknownStatusRows,
      duplicate_processos: report.duplicateProcessos,
    })
    .select("id")
    .single();
  if (batchError) throw batchError;

  let insertedRows = 0;
  for (const chunk of chunks(records, batchSize)) {
    const payload = chunk.map((record) => ({
      ...record,
      import_batch_id: batch.id,
      is_latest: false,
    }));
    const { data, error } = await supabase.from("salesforce_orders").insert(payload).select("id");
    if (error) throw error;
    insertedRows += data?.length ?? 0;
  }

  await insertImportWarnings(supabase, batch.id, records);

  const { error: unsetError } = await supabase.from("salesforce_orders").update({ is_latest: false }).eq("is_latest", true);
  if (unsetError) throw unsetError;

  const { error: setError } = await supabase.from("salesforce_orders").update({ is_latest: true }).eq("import_batch_id", batch.id);
  if (setError) throw setError;

  const refreshedProcessSummaries = await refreshSalesforceOrderSummaries(supabase);

  const afterCounts = {
    sentences: await countTable(supabase, "sentences"),
    sentenceEvents: await countTable(supabase, "sentence_events"),
  };

  return {
    importBatchId: batch.id,
    insertedRows,
    refreshedProcessSummaries,
    beforeCounts,
    afterCounts,
    sentenceTablesUnchanged: beforeCounts.sentences === afterCounts.sentences && beforeCounts.sentenceEvents === afterCounts.sentenceEvents,
  };
}

async function insertImportWarnings(supabase, importBatchId, records) {
  const warnings = [];
  for (const record of records) {
    if (!record.processo) {
      warnings.push({
        import_batch_id: importBatchId,
        sheet_name: "Salesforce Orders",
        row_number: record.import_row_number,
        severity: "warning",
        field_name: "processo",
        message: "Processo nao encontrado em Assunto nem nas Observacoes.",
        raw_payload: record.raw_import_payload,
      });
    }
    if (record.status_bucket === "unknown") {
      warnings.push({
        import_batch_id: importBatchId,
        sheet_name: "Salesforce Orders",
        row_number: record.import_row_number,
        severity: "warning",
        field_name: "Status",
        message: `Status do caso nao classificado: ${record.case_status ?? ""}`,
        raw_payload: record.raw_import_payload,
      });
    }
  }

  for (const chunk of chunks(warnings.slice(0, 5000), 1000)) {
    if (chunk.length === 0) continue;
    const { error } = await supabase.from("import_errors").insert(chunk);
    if (error) throw error;
  }
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function writePreview(outputPath, payload) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
}

const options = parseArgs(process.argv.slice(2));
await loadEnvFile(path.join(rootDir, ".env.local"));
await loadEnvFile(path.join(rootDir, ".env"));

const workbookPath = options.workbookPath ?? await findDefaultWorkbook();
if (!workbookPath) {
  throw new Error("Informe o caminho da planilha Salesforce ou coloque o relatorio mais recente em Downloads.");
}

const source = readSalesforceSheet(workbookPath);
const records = source.rows.map((row) => buildRecord(row, source.uniqueHeaders, source.columnIndexes));
const supabase = await createSupabaseClient(options.importMode || Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY));
const report = await appendMatchStats(supabase, buildReport(records), records);

const preview = {
  generatedAt: new Date().toISOString(),
  workbookPath,
  sheetName: source.sheetName,
  headerRowNumber: source.headerRowNumber,
  mode: options.importMode ? "import" : "dry-run",
  statusPolicy: "open when Salesforce case Status is Em processo, Em Progresso, or Suspenso",
  report,
  sample: records.slice(0, 10).map((record) => ({
    import_row_number: record.import_row_number,
    processo: record.processo,
    processo_source: record.processo_source,
    case_status: record.case_status,
    status_bucket: record.status_bucket,
    order_key: record.order_key,
    salesforce_case_number: record.salesforce_case_number,
    subreason: record.subreason,
  })),
};

if (options.importMode) {
  if (!supabase) throw new Error("Supabase service role nao configurado.");
  preview.importResult = await importRecords(supabase, workbookPath, records, report, options.batchSize);
}

await writePreview(options.outputPath, preview);
console.log(JSON.stringify(preview, null, 2));
