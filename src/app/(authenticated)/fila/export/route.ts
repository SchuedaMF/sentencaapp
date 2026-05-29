import * as XLSX from "xlsx";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { canExportSentences as canExportSentencesPermission } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sampleSentences } from "@/lib/sample-data";
import type { Profile } from "@/lib/types";

const exportPageSize = 1000;
const sheetName = "sentences";
const filenamePrefix = "sentences-completa";

const sentenceExportColumns = [
  "id",
  "import_batch_id",
  "import_row_number",
  "legacy_id_sentenca",
  "processo",
  "data_publicacao",
  "envio_bcc",
  "origem_raw",
  "origem_normalized",
  "tratado",
  "tipo_justica_raw",
  "tipo_justica_normalized",
  "cpf_cnpj",
  "autor",
  "tipo_cliente",
  "uc",
  "municipio_raw",
  "municipio_normalized",
  "tipo_decisao_raw",
  "tipo_decisao_normalized",
  "observacao",
  "valor_multa",
  "prazo_fatal",
  "tipo_servico_raw",
  "responsavel_cumprimento",
  "responsavel_qualidade",
  "cumprimento_status",
  "qualidade_status",
  "cumprimento_data",
  "qualidade_data",
  "data_ultimo_evento",
  "raw_import_payload",
  "import_warnings",
  "created_at",
  "updated_at",
  "cumprimento_base_status",
  "qualidade_base_status",
  "cumprimento_base_data",
  "qualidade_base_data",
  "data_ultimo_evento_base",
] as const;

type ExportRow = Record<string, unknown>;
type SupabaseServerClient = NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;

export async function GET() {
  await connection();

  const supabase = await createSupabaseServerClient();
  if (!supabase) return buildWorkbookResponse(sampleSentences as ExportRow[]);

  const profile = await getExportProfile(supabase);
  if (!canExportSentencesPermission(profile)) {
    return new Response("Exportacao restrita a administradores, gestores e analistas.", { status: 403 });
  }

  try {
    const rows = await fetchSentenceRows(supabase);
    return buildWorkbookResponse(rows as ExportRow[]);
  } catch (error) {
    console.error("Failed to export sentences", error);
    return new Response("Nao foi possivel gerar a exportacao.", { status: 500 });
  }
}

async function getExportProfile(supabase: SupabaseServerClient): Promise<Profile> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,role,active")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (error) throw new Error(`getExportProfile failed: ${error.message}`);
  if (data && !data.active) redirect("/login?error=Usuario%20inativo");

  return data
    ? (data as Profile)
    : {
        id: auth.user.id,
        email: auth.user.email ?? "",
        full_name: auth.user.user_metadata?.full_name ?? null,
        role: "operador",
        active: true,
      };
}

async function fetchSentenceRows(supabase: SupabaseServerClient) {
  const rows: ExportRow[] = [];

  for (let from = 0; ; from += exportPageSize) {
    const { data, error } = await supabase
      .from("sentences")
      .select("*")
      .order("id", { ascending: true })
      .range(from, from + exportPageSize - 1);

    if (error) throw new Error(`fetchSentenceRows failed: ${error.message}`);
    rows.push(...((data ?? []) as ExportRow[]));
    if (!data || data.length < exportPageSize) break;
  }

  return rows;
}

function buildWorkbookResponse(rows: ExportRow[]) {
  const columns = resolveColumns(rows);
  const normalizedRows = rows.map((row) => normalizeRow(row, columns));
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([columns]);

  if (normalizedRows.length > 0) {
    XLSX.utils.sheet_add_json(worksheet, normalizedRows, {
      header: columns,
      origin: "A2",
      skipHeader: true,
    });
  }

  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  const buffer = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
  }) as Uint8Array;
  const body = toArrayBuffer(buffer);
  const filename = `${filenamePrefix}-${formatSaoPauloDate(new Date())}.xlsx`;

  return new Response(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": String(buffer.byteLength),
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}

function resolveColumns(rows: ExportRow[]) {
  const columns = new Set<string>(sentenceExportColumns);

  for (const row of rows) {
    for (const key of Object.keys(row)) columns.add(key);
  }

  return [...columns];
}

function normalizeRow(row: ExportRow, columns: string[]) {
  return Object.fromEntries(columns.map((column) => [column, normalizeCellValue(row[column])]));
}

function normalizeCellValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function toArrayBuffer(buffer: Uint8Array) {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}

function formatSaoPauloDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}
