import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const defaultWorkbook = "C:/Users/jur.david/Documents/Base RJ - Sentença.xlsx";

const canonicalStatus = new Set(["ENTREGUE", "PENDENTE", "EM ANDAMENTO", "ESTOQUE"]);
const eventPendingAliases = new Map([
  ["AREA", "ÁREA"],
  ["QUESTIONADO", "QUESTIONAMENTO AO ESCRITÓRIO"],
  ["QUESTIONADOAOESCRITORIO", "QUESTIONAMENTO AO ESCRITÓRIO"],
  ["QUESTIONADO AO ESCRITORIO", "QUESTIONAMENTO AO ESCRITÓRIO"],
  ["QUESTIONAMENTO AO ESCRITORIO", "QUESTIONAMENTO AO ESCRITÓRIO"],
  ["ESCRITORIO", "QUESTIONAMENTO AO ESCRITÓRIO"],
  ["PETICIONAR", "PETICIONADO"],
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
const ignoredOperationalFields = ["STATUS CUMPRIMENTO", "STATUS QUALIDADE", "DATA DO INGRESSO CUMPRIMENTO", "DATA QUALIDADE", "DATA_PENDENTE"];
const legacyComparisons = [
  ["STATUS CUMPRIMENTO", "STATUS_CUMPRIMENTO"],
  ["STATUS QUALIDADE", "STATUS_QUALIDADE"],
  ["DATA DO INGRESSO CUMPRIMENTO", "DATA_CUMPRIMENTO"],
  ["DATA QUALIDADE", "DATA_QUALIDADE"],
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

function normalizeHeader(value) {
  return normalizeText(value).replace(/\s+/g, " ");
}

function nullableText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\u00a0/g, " ").trim();
  return text === "" ? null : text;
}

function get(row, fieldName) {
  return row[normalizeHeader(fieldName)] ?? null;
}

function normalizeStatus(value, warnings, fieldName, rowNumber) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (canonicalStatus.has(normalized)) return normalized;
  warnings.push({
    severity: "warning",
    rowNumber,
    fieldName,
    message: `Status invalido tratado como vazio: ${String(value)}`,
  });
  return null;
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

function canonicalizeKnownEventArea(value) {
  const key = normalizeEventTaxonomyKey(value);
  if (!key) return null;
  if (eventAreaAliases.has(key)) return eventAreaAliases.get(key);

  const cleaned = cleanEventTaxonomyText(value);
  return eventAreaOptions.has(cleaned) ? cleaned : null;
}

function canonicalizeEventPendencia(value) {
  const key = normalizeEventTaxonomyKey(value);
  if (!key) return null;

  const direct = eventPendingAliases.get(key);
  if (direct) return direct;

  return canonicalizeKnownEventArea(value) ? "ÁREA" : null;
}

function normalizePendencia(value, warnings, fieldName, rowNumber) {
  const raw = nullableText(value);
  if (!raw) return null;

  const normalized = canonicalizeEventPendencia(raw);
  if (normalized) return normalized;

  warnings.push({
    severity: "warning",
    rowNumber,
    fieldName,
    message: `Pendencia invalida tratada como vazio: ${String(value)}`,
  });
  return null;
}

function parseDate(value, warnings, fieldName, rowNumber) {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return validBusinessDate(value, warnings, fieldName, rowNumber, String(value));
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return invalidDate(warnings, fieldName, rowNumber, value);
    return validBusinessDate(new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)), warnings, fieldName, rowNumber, String(value));
  }

  const text = String(value).trim();
  if (!text || text === "00:00:00") return invalidDate(warnings, fieldName, rowNumber, value);

  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = Number(match[3]);
    const day = first > 12 ? first : second > 12 ? second : first;
    const month = first > 12 ? second : second > 12 ? first : second;
    return validBusinessDate(new Date(Date.UTC(year, month - 1, day)), warnings, fieldName, rowNumber, text);
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return validBusinessDate(parsed, warnings, fieldName, rowNumber, text);
  return invalidDate(warnings, fieldName, rowNumber, value);
}

function validBusinessDate(date, warnings, fieldName, rowNumber, original) {
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2035) return invalidDate(warnings, fieldName, rowNumber, original);
  return date.toISOString().slice(0, 10);
}

function invalidDate(warnings, fieldName, rowNumber, value) {
  warnings.push({
    severity: "warning",
    rowNumber,
    fieldName,
    message: `Data invalida tratada como vazio: ${String(value)}`,
  });
  return null;
}

function parseMoney(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).replace(/\./g, "").replace(",", ".").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function splitServices(value) {
  const text = nullableText(value);
  if (!text) return [];
  return text
    .split(/\s*,\s*|\s*;\s*|\s*\|\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function comparableValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    if (year < 2000 || year > 2035) return null;
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y >= 2000 && parsed.y <= 2035) {
      return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)).toISOString().slice(0, 10);
    }
  }
  const text = String(value).trim();
  if (!text || text === "00:00:00") return null;
  return normalizeText(text);
}

function readSheet(workbookPath) {
  const workbook = XLSX.readFile(workbookPath, { cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => normalizeText(name) === "BASE SENTENCA");
  if (!sheetName) throw new Error("Aba BASE SENTENCA nao encontrada.");
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null, raw: true });
  const headers = matrix[0].map((header) => normalizeHeader(header));
  return matrix.slice(1).map((values, index) => {
    const row = {};
    headers.forEach((header, colIndex) => {
      if (header) row[header] = values[colIndex] ?? null;
    });
    return { row, rowNumber: index + 2 };
  });
}

function buildPayload(row, rowNumber) {
  const warnings = [];
  const rawImportPayload = Object.fromEntries(Object.entries(row));
  const cumprimentoStatus = normalizeStatus(get(row, "STATUS_CUMPRIMENTO"), warnings, "STATUS_CUMPRIMENTO", rowNumber);
  const qualidadeStatus = normalizeStatus(get(row, "STATUS_QUALIDADE"), warnings, "STATUS_QUALIDADE", rowNumber);
  const cumprimentoData = parseDate(get(row, "DATA_CUMPRIMENTO"), warnings, "DATA_CUMPRIMENTO", rowNumber);
  const qualidadeData = parseDate(get(row, "DATA_QUALIDADE"), warnings, "DATA_QUALIDADE", rowNumber);
  const dataUltimoEvento = parseDate(get(row, "DATA_ULTIMO_EVENTO"), warnings, "DATA_ULTIMO_EVENTO", rowNumber);
  const normalizedPendencia = normalizePendencia(get(row, "PENDENCIA"), warnings, "PENDENCIA", rowNumber);
  const currentPendencia = cumprimentoStatus === "PENDENTE" || qualidadeStatus === "PENDENTE" ? normalizedPendencia : null;
  const sentence = {
    import_row_number: rowNumber,
    legacy_id_sentenca: nullableText(get(row, "ID_SENTENCA")),
    processo: nullableText(get(row, "PROCESSO")),
    data_publicacao: parseDate(get(row, "DATA PUBLICAÇAO"), warnings, "DATA PUBLICAÇAO", rowNumber),
    envio_bcc: parseDate(get(row, "ENVIO PARA BCC"), warnings, "ENVIO PARA BCC", rowNumber),
    origem_raw: nullableText(get(row, "ORIGEM")),
    origem_normalized: normalizeText(get(row, "ORIGEM")) || null,
    tratado: parseDate(get(row, "TRATADO"), warnings, "TRATADO", rowNumber),
    tipo_justica_raw: nullableText(get(row, "TIPO DE JUSTICA")),
    tipo_justica_normalized: normalizeText(get(row, "TIPO DE JUSTICA")) || null,
    cpf_cnpj: nullableText(get(row, "CPF/CNPJ")),
    autor: nullableText(get(row, "AUTOR")),
    tipo_cliente: nullableText(get(row, "TIPO DE CLIENTE")),
    uc: nullableText(get(row, "UC")),
    municipio_raw: nullableText(get(row, "MUNICÍPIO")),
    municipio_normalized: normalizeText(get(row, "MUNICÍPIO")) || null,
    tipo_decisao_raw: nullableText(get(row, "TIPO DE DECISÃO")),
    tipo_decisao_normalized: normalizeText(get(row, "TIPO DE DECISÃO")) || null,
    observacao: nullableText(get(row, "OBSERVAÇÃO")),
    valor_multa: parseMoney(get(row, "VALOR DA MULTA")),
    prazo_fatal: parseDate(get(row, "PRAZO FATAL"), warnings, "PRAZO FATAL", rowNumber),
    tipo_servico_raw: nullableText(get(row, "TIPO DE SERVICO")),
    responsavel_cumprimento: nullableText(get(row, "RESPONSAVELCUMPRIMENTO")),
    responsavel_qualidade: nullableText(get(row, "RESPONSÁVEL QUALIDADE")),
    pendencia: currentPendencia,
    cumprimento_status: cumprimentoStatus,
    qualidade_status: qualidadeStatus,
    cumprimento_data: cumprimentoData,
    qualidade_data: qualidadeData,
    data_ultimo_evento: dataUltimoEvento,
    cumprimento_base_status: cumprimentoStatus,
    qualidade_base_status: qualidadeStatus,
    cumprimento_base_data: cumprimentoData,
    qualidade_base_data: qualidadeData,
    data_ultimo_evento_base: dataUltimoEvento,
    pendencia_base: currentPendencia,
    raw_import_payload: rawImportPayload,
    import_warnings: warnings,
  };

  if (!sentence.processo) {
    warnings.push({ severity: "error", rowNumber, fieldName: "PROCESSO", message: "Processo vazio; registro nao pode ser importado." });
  }

  for (const [legacyField, canonicalField] of legacyComparisons) {
    const legacyValue = comparableValue(get(row, legacyField));
    const canonicalValue = comparableValue(get(row, canonicalField));
    if (legacyValue !== null && canonicalValue !== null && legacyValue !== canonicalValue) {
      warnings.push({
        severity: "warning",
        rowNumber,
        fieldName: canonicalField,
        message: `Divergencia preservada no payload bruto: ${legacyField}=${legacyValue}; ${canonicalField}=${canonicalValue}`,
      });
    }
  }

  return { sentence, services: splitServices(get(row, "TIPO DE SERVICO")), warnings };
}

function buildReport(records) {
  const sentenceIds = new Map();
  const processos = new Map();
  const warnings = [];

  for (const record of records) {
    const { sentence } = record;
    if (sentence.legacy_id_sentenca) sentenceIds.set(sentence.legacy_id_sentenca, (sentenceIds.get(sentence.legacy_id_sentenca) ?? 0) + 1);
    if (sentence.processo) processos.set(sentence.processo, (processos.get(sentence.processo) ?? 0) + 1);
    warnings.push(...record.warnings);
  }

  return {
    totalRows: records.length,
    importableRows: records.filter((record) => record.sentence.processo).length,
    warningRows: records.filter((record) => record.warnings.some((warning) => warning.severity === "warning")).length,
    errorRows: records.filter((record) => record.warnings.some((warning) => warning.severity === "error")).length,
    duplicateSentenceIds: [...sentenceIds.values()].filter((count) => count > 1).length,
    duplicateProcessos: [...processos.values()].filter((count) => count > 1).length,
    warnings,
  };
}

async function writePreview(outputPath, records, report) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        canonicalFields: ["STATUS_CUMPRIMENTO", "STATUS_QUALIDADE", "DATA_CUMPRIMENTO", "DATA_QUALIDADE", "DATA_ULTIMO_EVENTO", "PENDENCIA"],
        ignoredOperationalFields,
        report,
        sample: records.slice(0, 20),
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function importToSupabase(records, report, fileName) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .insert({
      file_name: path.basename(fileName),
      total_rows: report.totalRows,
      imported_rows: report.importableRows,
      warning_rows: report.warningRows,
      duplicate_sentence_ids: report.duplicateSentenceIds,
      duplicate_processos: report.duplicateProcessos,
    })
    .select("id")
    .single();
  if (batchError) throw batchError;

  const importableRecords = records.filter((item) => item.sentence.processo);
  const sentenceIdByRow = new Map();
  for (const chunk of chunks(importableRecords, 200)) {
    const payload = chunk.map((record) => ({ ...record.sentence, import_batch_id: batch.id }));
    const { data: inserted, error } = await supabase
      .from("sentences")
      .insert(payload)
      .select("id, import_row_number");
    if (error) throw error;
    for (const sentence of inserted ?? []) {
      sentenceIdByRow.set(sentence.import_row_number, sentence.id);
    }
  }

  const servicesByNormalized = new Map();
  for (const record of importableRecords) {
    for (const service of record.services) {
      const normalized = normalizeText(service);
      if (normalized && !servicesByNormalized.has(normalized)) {
        servicesByNormalized.set(normalized, service);
      }
    }
  }

  const serviceIdByNormalized = new Map();
  const servicePayload = [...servicesByNormalized.entries()].map(([normalized_name, name]) => ({ name, normalized_name }));
  for (const chunk of chunks(servicePayload, 200)) {
    const { data: services, error } = await supabase
      .from("service_types")
      .upsert(chunk, { onConflict: "normalized_name" })
      .select("id, normalized_name");
    if (error) throw error;
    for (const service of services ?? []) {
      serviceIdByNormalized.set(service.normalized_name, service.id);
    }
  }

  const links = [];
  const linkKeys = new Set();
  for (const record of importableRecords) {
    const sentenceId = sentenceIdByRow.get(record.sentence.import_row_number);
    if (!sentenceId) continue;
    for (const service of record.services) {
      const serviceId = serviceIdByNormalized.get(normalizeText(service));
      const key = `${sentenceId}:${serviceId}`;
      if (serviceId && !linkKeys.has(key)) {
        links.push({ sentence_id: sentenceId, service_type_id: serviceId });
        linkKeys.add(key);
      }
    }
  }

  for (const chunk of chunks(links, 1000)) {
    const { error } = await supabase.from("sentence_services").upsert(chunk);
    if (error) throw error;
  }

  if (report.warnings.length > 0) {
    const payload = report.warnings.slice(0, 5000).map((warning) => ({
      import_batch_id: batch.id,
      sheet_name: "BASE SENTENÇA",
      row_number: warning.rowNumber,
      severity: warning.severity,
      field_name: warning.fieldName,
      message: warning.message,
      raw_payload: {},
    }));
    for (const chunk of chunks(payload, 1000)) {
      const { error } = await supabase.from("import_errors").insert(chunk);
      if (error) throw error;
    }
  }

  return true;
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

const workbookPath = path.resolve(process.argv[2] ?? defaultWorkbook);
const outputPath = path.join(rootDir, "outputs", "import-preview.json");
const records = readSheet(workbookPath).map(({ row, rowNumber }) => buildPayload(row, rowNumber));
const report = buildReport(records);
await writePreview(outputPath, records, report);
const imported = await importToSupabase(records, report, workbookPath);

console.log(JSON.stringify({ workbookPath, outputPath, imported, report: { ...report, warnings: report.warnings.slice(0, 20) } }, null, 2));
