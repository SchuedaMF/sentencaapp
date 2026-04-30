import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const defaultWorkbook = "C:/Users/jur.david/Documents/Base - Eventos.xlsx";
const defaultOutputPath = path.join(rootDir, "outputs", "sentence-events-import-preview.json");
const validStages = new Set(["CUMPRIMENTO", "QUALIDADE"]);
const validEventTypes = new Set(["PENDENTE", "ENTREGUE"]);
const eventPendingOptions = new Set([
  "QUESTIONAMENTO AO ESCRITÓRIO",
  "ÁREA",
  "PETICIONADO",
  "CUMPRIMENTO INCORRETO",
]);
const eventPendingAliases = new Map([
  ["AREA", "ÁREA"],
  ["QUESTIONADO", "QUESTIONAMENTO AO ESCRITÓRIO"],
  ["QUESTIONADOAOESCRITORIO", "QUESTIONAMENTO AO ESCRITÓRIO"],
  ["QUESTIONADO AO ESCRITORIO", "QUESTIONAMENTO AO ESCRITÓRIO"],
  ["QUESTIONAMENTO AO ESCRITORIO", "QUESTIONAMENTO AO ESCRITÓRIO"],
  ["ESCRITORIO", "QUESTIONAMENTO AO ESCRITÓRIO"],
  ["PETICIONAMENTO ESCRITORIO", "PETICIONADO"],
  ["PETICIONADO", "PETICIONADO"],
  ["CUMPRIMENTO INCOMPLETO", "CUMPRIMENTO INCORRETO"],
  ["CUMPRIMENTO INCORRETO", "CUMPRIMENTO INCORRETO"],
  ["ANALISE DE CONS INCLUIDO", "ÁREA"],
  ["CANCELAR DEBITO", "ÁREA"],
]);
const eventAreaOptions = new Set([
  "ALTERAÇÕES CADASTRAIS",
  "REFATURAMENTO",
  "ENVIO DE AR",
  "TOI",
  "FATURAMENTO",
  "VISTORIA",
  "MANUTENÇÃO",
  "COBRANÇA PROTESTO/ESPECIAIS",
  "LIGAÇÃO NOVA",
  "CANCELAMENTO DE TOI",
  "CORTE/RELIGAÇÃO",
  "SUBSTITUIÇÃO DE MEDIDOR",
  "TROCA DE TITULARIDADE",
  "CRÉDITO ACORDO",
  "RCE",
  "ESCRITÓRIO",
  "EVIDÊNCIAS",
  "GD",
  "OBRAS",
  "PARCELAMENTO",
  "ACRÉSCIMO DE CARGA",
  "BAIXA RENDA",
  "ENCERRAMENTO CONTRATUAL",
  "GRUPO A",
  "REFORMA DE PADRÃO",
  "RELIGAÇÃO",
  "REPARO MEDIDOR",
  "RESSARCIMENTO",
  "TRANSFERÊNCIA DE DÉBITOS",
]);
const eventAreaAliases = new Map([
  ["AREA", null],
  ["ALT CADASTRAIS", "ALTERAÇÕES CADASTRAIS"],
  ["ALTERACAO CADASTRAL", "ALTERAÇÕES CADASTRAIS"],
  ["ALTERACOES CADASTRAIS", "ALTERAÇÕES CADASTRAIS"],
  ["ACRESCIMO DE CARGA", "ACRÉSCIMO DE CARGA"],
  ["AR", "ENVIO DE AR"],
  ["ENVIO DE A.R", "ENVIO DE AR"],
  ["ENVIO DE AR", "ENVIO DE AR"],
  ["MANUTENCAO", "MANUTENÇÃO"],
  ["COBRANCA PROTESTO/ESPECIAIS", "COBRANÇA PROTESTO/ESPECIAIS"],
  ["LIGACAO NOVA", "LIGAÇÃO NOVA"],
  ["CANCELAMENTO TOI", "CANCELAMENTO DE TOI"],
  ["CANCELAMENTO DE TOI", "CANCELAMENTO DE TOI"],
  ["CORTE/RELIGACAO", "CORTE/RELIGAÇÃO"],
  ["SUBSTITUICAO DE MEDIDDOR", "SUBSTITUIÇÃO DE MEDIDOR"],
  ["SUBSTITUICAO DE MEDIDOR", "SUBSTITUIÇÃO DE MEDIDOR"],
  ["CREDITO ACORDO", "CRÉDITO ACORDO"],
  ["ESCRITORIO", "ESCRITÓRIO"],
  ["ESC", "ESCRITÓRIO"],
  ["EVIDENCIAS", "EVIDÊNCIAS"],
  ["GD", "GD"],
  ["REFAT GD", "GD"],
  ["REFORMA DE PADRAO", "REFORMA DE PADRÃO"],
  ["RELIGACAO", "RELIGAÇÃO"],
  ["TRANSFERENCIA DE DEBITOS", "TRANSFERÊNCIA DE DÉBITOS"],
]);
const requiredMigrationHint =
  "Rode a migration 20260428150000_historical_sentence_events_preserve_state.sql antes de importar eventos.";
const stateFields = [
  "cumprimento_status",
  "qualidade_status",
  "cumprimento_data",
  "qualidade_data",
  "data_ultimo_evento",
];

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function cleanEventTaxonomyText(value) {
  const text = nullableText(value)?.replace(/\s+/g, " ").trim() ?? "";
  return text ? text.toLocaleUpperCase("pt-BR") : "";
}

function normalizeEventTaxonomyKey(value) {
  return cleanEventTaxonomyText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function canonicalizeEventPendencia(value) {
  const key = normalizeEventTaxonomyKey(value);
  if (!key) return null;

  const direct = eventPendingAliases.get(key);
  if (direct) return direct;

  return canonicalizeKnownEventArea(value) ? "ÁREA" : null;
}

function canonicalizeKnownEventArea(value) {
  const key = normalizeEventTaxonomyKey(value);
  if (!key) return null;

  if (eventAreaAliases.has(key)) return eventAreaAliases.get(key);

  const cleaned = cleanEventTaxonomyText(value);
  return eventAreaOptions.has(cleaned) ? cleaned : null;
}

function normalizeCustomEventArea(value) {
  const cleaned = cleanEventTaxonomyText(value);
  if (!cleaned || normalizeEventTaxonomyKey(cleaned) === "AREA") return null;

  return canonicalizeKnownEventArea(cleaned) ?? cleaned;
}

function normalizeEventAreaForImport(area, pendencia, normalizedPendencia) {
  return normalizeCustomEventArea(area) ?? (normalizedPendencia === "ÁREA" ? canonicalizeKnownEventArea(pendencia) : null);
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/\s+/g, " ");
}

function nullableText(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatDate(value);
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value).trim();
  const text = String(value).replace(/\u00a0/g, " ").trim();
  return text === "" ? null : text;
}

function normalizeLookupText(value) {
  return nullableText(value)?.replace(/\s+/g, " ").trim() ?? null;
}

function rawValue(value) {
  if (value === undefined) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatDate(value);
  return value;
}

function get(row, fieldName) {
  return row.normalized[normalizeHeader(fieldName)] ?? null;
}

function parseDate(value, issues, fieldName, rowNumber) {
  if (value === null || value === undefined || value === "") {
    issues.push(issue(rowNumber, fieldName, "Data obrigatoria vazia."));
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) return validBusinessDate(value, issues, fieldName, rowNumber, String(value));

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return invalidDate(issues, fieldName, rowNumber, value);
    return validBusinessDate(new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)), issues, fieldName, rowNumber, String(value));
  }

  const text = String(value).trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    return validBusinessDate(
      new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]))),
      issues,
      fieldName,
      rowNumber,
      text,
    );
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return validBusinessDate(parsed, issues, fieldName, rowNumber, text);
  return invalidDate(issues, fieldName, rowNumber, value);
}

function validBusinessDate(date, issues, fieldName, rowNumber, original) {
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2035) return invalidDate(issues, fieldName, rowNumber, original);
  return formatDate(date);
}

function invalidDate(issues, fieldName, rowNumber, value) {
  issues.push(issue(rowNumber, fieldName, `Data invalida: ${String(value)}`));
  return null;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function issue(rowNumber, fieldName, message, code = "invalid") {
  return { rowNumber, fieldName, message, code };
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

function parseArgs(argv) {
  const options = {
    workbookPath: defaultWorkbook,
    outputPath: defaultOutputPath,
    importMode: false,
    batchSize: 100,
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

function readEventsSheet(workbookPath) {
  const workbook = XLSX.readFile(workbookPath, { cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => normalizeText(name) === "ANDAMENTO");
  if (!sheetName) throw new Error("Aba ANDAMENTO nao encontrada.");

  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null, raw: true, blankrows: false });
  if (matrix.length === 0) throw new Error("Aba ANDAMENTO esta vazia.");

  const headers = matrix[0].map((header) => nullableText(header) ?? "");
  const normalizedHeaders = headers.map(normalizeHeader);

  return matrix.slice(1)
    .map((values, index) => ({ values, rowNumber: index + 2 }))
    .filter(({ values }) => values.some((value) => value !== null && value !== undefined && String(value).trim() !== ""))
    .map(({ values, rowNumber }) => {
      const normalized = {};
      const raw = {};
      headers.forEach((header, colIndex) => {
        if (!header) return;
        normalized[normalizedHeaders[colIndex]] = values[colIndex] ?? null;
        raw[header] = rawValue(values[colIndex] ?? null);
      });
      return { normalized, raw, rowNumber };
    });
}

function buildRecord(row) {
  const issues = [];
  const etapa = normalizeText(get(row, "ETAPA"));
  const tipoEvento = normalizeText(get(row, "TIPO_EVENTO"));
  const dataEvento = parseDate(get(row, "DATA_EVENTO"), issues, "DATA_EVENTO", row.rowNumber);
  const legacyIdAndamento = normalizeLookupText(get(row, "ID_ANDAMENTO"));
  const rawPendencia = nullableText(get(row, "PENDENCIA"));
  const normalizedPendencia = canonicalizeEventPendencia(rawPendencia);
  const normalizedArea = normalizeEventAreaForImport(nullableText(get(row, "AREA")), rawPendencia, normalizedPendencia);

  if (!legacyIdAndamento) issues.push(issue(row.rowNumber, "ID_ANDAMENTO", "ID_ANDAMENTO obrigatorio vazio."));
  if (!validStages.has(etapa)) issues.push(issue(row.rowNumber, "ETAPA", `Etapa invalida: ${String(get(row, "ETAPA") ?? "")}`));
  if (!validEventTypes.has(tipoEvento)) {
    issues.push(issue(row.rowNumber, "TIPO_EVENTO", `Tipo de evento invalido: ${String(get(row, "TIPO_EVENTO") ?? "")}`));
  }
  if (rawPendencia && (!normalizedPendencia || !eventPendingOptions.has(normalizedPendencia))) {
    issues.push(issue(row.rowNumber, "PENDENCIA", `Pendencia invalida: ${rawPendencia}`));
  }

  return {
    rowNumber: row.rowNumber,
    raw: row.raw,
    issues,
    source: {
      legacyIdSentenca: normalizeLookupText(get(row, "ID_SENTENCA")),
      legacyIdAndamento,
      processo: normalizeLookupText(get(row, "N_PROCESSO")),
      etapa,
      tipoEvento,
      dataEvento,
      responsavel: nullableText(get(row, "RESPONSAVEL")),
      pendencia: normalizedPendencia,
      area: normalizedArea,
      obs: nullableText(get(row, "OBS")),
    },
  };
}

function buildIndexes(sentences) {
  return {
    byLegacyId: indexBy(sentences, "legacy_id_sentenca"),
    byProcesso: indexBy(sentences, "processo"),
  };
}

function indexBy(rows, fieldName) {
  const map = new Map();
  for (const row of rows) {
    const value = normalizeLookupText(row[fieldName]);
    if (!value) continue;
    const matches = map.get(value) ?? [];
    matches.push(row);
    map.set(value, matches);
  }
  return map;
}

function resolveRecord(record, indexes) {
  if (record.issues.length > 0) {
    return skippedRecord(record, "invalid_row", record.issues[0]?.fieldName ?? null, record.issues.map((item) => item.message).join(" | "));
  }

  const { legacyIdSentenca, processo } = record.source;

  if (legacyIdSentenca) {
    const matches = indexes.byLegacyId.get(legacyIdSentenca) ?? [];
    if (matches.length === 1) return importableRecord(record, matches[0], "ID_SENTENCA");
    if (matches.length > 1) {
      return skippedRecord(record, "ambiguous_id_sentenca", "ID_SENTENCA", `ID_SENTENCA com ${matches.length} sentencas no banco.`);
    }
  }

  if (processo) {
    const matches = indexes.byProcesso.get(processo) ?? [];
    if (matches.length === 1) return importableRecord(record, matches[0], "N_PROCESSO");
    if (matches.length > 1) {
      return skippedRecord(record, "ambiguous_processo", "N_PROCESSO", `N_PROCESSO com ${matches.length} sentencas no banco.`);
    }
  }

  if (!legacyIdSentenca && !processo) {
    return skippedRecord(record, "missing_match_keys", "ID_SENTENCA", "Linha sem ID_SENTENCA e sem N_PROCESSO.");
  }

  return skippedRecord(record, "sentence_not_found", "ID_SENTENCA", "Nenhuma sentenca encontrada por ID_SENTENCA ou N_PROCESSO.");
}

function importableRecord(record, sentence, matchBy) {
  return {
    ...record,
    importable: true,
    matchBy,
    sentenceId: sentence.id,
  };
}

function skippedRecord(record, reasonCode, fieldName, message) {
  return {
    ...record,
    importable: false,
    skip: {
      rowNumber: record.rowNumber,
      reasonCode,
      fieldName,
      message,
      raw: record.raw,
    },
  };
}

function buildEventPayload(record, importBatchId) {
  return {
    sentence_id: record.sentenceId,
    etapa: record.source.etapa,
    tipo_evento: record.source.tipoEvento,
    data_evento: record.source.dataEvento,
    responsavel: record.source.responsavel,
    pendencia: record.source.pendencia,
    area: record.source.area,
    obs: record.source.obs,
    raw_import_payload: record.raw,
    legacy_id_andamento: record.source.legacyIdAndamento,
    import_batch_id: importBatchId,
    import_row_number: record.rowNumber,
    affects_operational_state: false,
  };
}

function summarize(records, existingLegacyIds) {
  const importable = records.filter((record) => record.importable);
  const skipped = records.filter((record) => !record.importable).map((record) => record.skip);
  const alreadyImported = importable.filter((record) => existingLegacyIds.has(record.source.legacyIdAndamento));
  const newImportable = importable.filter((record) => !existingLegacyIds.has(record.source.legacyIdAndamento));
  const skipsByReason = new Map();

  for (const skip of skipped) {
    skipsByReason.set(skip.reasonCode, (skipsByReason.get(skip.reasonCode) ?? 0) + 1);
  }

  return {
    totalRows: records.length,
    importableRows: importable.length,
    skippedRows: skipped.length,
    alreadyImportedRows: alreadyImported.length,
    newRows: newImportable.length,
    affectedSentences: new Set(importable.map((record) => record.sentenceId)).size,
    skipsByReason: Object.fromEntries([...skipsByReason.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    sampleSkipped: skipped.slice(0, 50).map((skip) => ({
      rowNumber: skip.rowNumber,
      reasonCode: skip.reasonCode,
      fieldName: skip.fieldName,
      message: skip.message,
    })),
  };
}

async function writePreview(outputPath, payload) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
}

function createSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para ler o Supabase.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function fetchAllSentences(supabase) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("sentences")
      .select(`id,legacy_id_sentenca,processo,${stateFields.join(",")}`)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function fetchExistingEventLegacyIds(supabase, ids, required) {
  const existing = new Set();
  for (const chunk of chunks([...new Set(ids.filter(Boolean))], 200)) {
    if (chunk.length === 0) continue;
    const { data, error } = await supabase
      .from("sentence_events")
      .select("legacy_id_andamento")
      .in("legacy_id_andamento", chunk);
    if (error) {
      if (!required) return existing;
      throw new Error(`${requiredMigrationHint} Detalhe: ${error.message}`);
    }
    for (const event of data ?? []) {
      if (event.legacy_id_andamento) existing.add(event.legacy_id_andamento);
    }
  }
  return existing;
}

async function createImportBatch(supabase, workbookPath, summary) {
  const { data, error } = await supabase
    .from("import_batches")
    .insert({
      file_name: path.basename(workbookPath),
      source_kind: "xlsx:sentence_events",
      total_rows: summary.totalRows,
      imported_rows: summary.newRows,
      warning_rows: summary.skippedRows,
      duplicate_sentence_ids: summary.skipsByReason.ambiguous_id_sentenca ?? 0,
      duplicate_processos: summary.skipsByReason.ambiguous_processo ?? 0,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function insertImportErrors(supabase, importBatchId, skipped) {
  const payload = skipped.slice(0, 5000).map((skip) => ({
    import_batch_id: importBatchId,
    sheet_name: "ANDAMENTO",
    row_number: skip.rowNumber,
    severity: "error",
    field_name: skip.fieldName,
    message: skip.message,
    raw_payload: skip.raw,
  }));

  for (const chunk of chunks(payload, 1000)) {
    if (chunk.length === 0) continue;
    const { error } = await supabase.from("import_errors").insert(chunk);
    if (error) throw error;
  }
}

async function importEvents(supabase, records, workbookPath, summary, batchSize) {
  const importable = records.filter((record) => record.importable);
  const skipped = records.filter((record) => !record.importable).map((record) => record.skip);
  const affectedSentenceIds = [...new Set(importable.map((record) => record.sentenceId))];
  const beforeStates = await fetchSentenceStates(supabase, affectedSentenceIds);
  const importBatchId = await createImportBatch(supabase, workbookPath, summary);
  const pendingRecords = importable.filter((record) => !summary.existingLegacyIds.has(record.source.legacyIdAndamento));
  const insertedIds = [];

  try {
    for (const chunk of chunks(pendingRecords, batchSize)) {
      const payload = chunk.map((record) => buildEventPayload(record, importBatchId));
      const { data, error } = await supabase
        .from("sentence_events")
        .insert(payload)
        .select("id,legacy_id_andamento");
      if (error) throw new Error(`${requiredMigrationHint} Detalhe: ${error.message}`);
      insertedIds.push(...((data ?? []).map((event) => event.id)));
    }

    await insertImportErrors(supabase, importBatchId, skipped);
    const afterStates = await fetchSentenceStates(supabase, affectedSentenceIds);
    const differences = diffStates(beforeStates, afterStates);

    if (differences.length > 0) {
      await restoreSentenceStates(supabase, beforeStates, differences.map((diff) => diff.id));
      const restoredStates = await fetchSentenceStates(supabase, differences.map((diff) => diff.id));
      const remainingDifferences = diffStates(filterStateMap(beforeStates, differences.map((diff) => diff.id)), restoredStates);
      if (remainingDifferences.length > 0) {
        throw new Error(`Importacao gravou eventos, mas nao conseguiu preservar ${remainingDifferences.length} status/data(s).`);
      }
    }

    return {
      importBatchId,
      insertedRows: insertedIds.length,
      skippedRows: skipped.length,
      statusDifferencesDetected: differences.length,
      statusDifferencesRestored: differences.length,
    };
  } catch (error) {
    await restoreSentenceStates(supabase, beforeStates, affectedSentenceIds).catch((restoreError) => {
      console.error("Falha ao restaurar snapshot de status apos erro:", restoreError.message);
    });
    throw error;
  }
}

async function fetchSentenceStates(supabase, ids) {
  const states = new Map();
  for (const chunk of chunks(ids, 200)) {
    if (chunk.length === 0) continue;
    const { data, error } = await supabase
      .from("sentences")
      .select(`id,${stateFields.join(",")}`)
      .in("id", chunk);
    if (error) throw error;
    for (const row of data ?? []) states.set(row.id, pickState(row));
  }
  return states;
}

function pickState(row) {
  return Object.fromEntries(stateFields.map((field) => [field, row[field] ?? null]));
}

function diffStates(before, after) {
  const differences = [];
  for (const [id, beforeState] of before.entries()) {
    const afterState = after.get(id);
    if (!afterState) {
      differences.push({ id, field: "row", before: "present", after: "missing" });
      continue;
    }
    for (const field of stateFields) {
      if ((beforeState[field] ?? null) !== (afterState[field] ?? null)) {
        differences.push({ id, field, before: beforeState[field] ?? null, after: afterState[field] ?? null });
      }
    }
  }
  return differences;
}

function filterStateMap(states, ids) {
  const filtered = new Map();
  for (const id of ids) {
    if (states.has(id)) filtered.set(id, states.get(id));
  }
  return filtered;
}

async function restoreSentenceStates(supabase, beforeStates, ids) {
  for (const id of ids) {
    const state = beforeStates.get(id);
    if (!state) continue;
    const { error } = await supabase.from("sentences").update(state).eq("id", id);
    if (error) throw error;
  }
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

const options = parseArgs(process.argv.slice(2));
await loadEnvFile(path.join(rootDir, ".env.local"));
await loadEnvFile(path.join(rootDir, ".env"));

const workbookPath = path.resolve(options.workbookPath);
const supabase = createSupabaseClient();
const rows = readEventsSheet(workbookPath);
const sentences = await fetchAllSentences(supabase);
const sentenceIndexes = buildIndexes(sentences);
const records = rows.map(buildRecord).map((record) => resolveRecord(record, sentenceIndexes));
const importableLegacyIds = records.filter((record) => record.importable).map((record) => record.source.legacyIdAndamento);
const existingLegacyIds = await fetchExistingEventLegacyIds(supabase, importableLegacyIds, options.importMode);
const summary = summarize(records, existingLegacyIds);
summary.existingLegacyIds = existingLegacyIds;

const preview = {
  generatedAt: new Date().toISOString(),
  workbookPath,
  mode: options.importMode ? "import" : "dry-run",
  statusPolicy: "imported events use affects_operational_state=false and must not alter sentences status/date fields",
  summary: {
    ...summary,
    existingLegacyIds: undefined,
  },
};

if (options.importMode) {
  preview.importResult = await importEvents(supabase, records, workbookPath, summary, options.batchSize);
}

await writePreview(options.outputPath, preview);
console.log(JSON.stringify(preview, null, 2));
