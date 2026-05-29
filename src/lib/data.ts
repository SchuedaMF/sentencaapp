import { differenceInCalendarDays, eachDayOfInterval, format, isValid, parseISO, startOfMonth, subDays } from "date-fns";
import { getAppRequestContext, type AppRequestContext, type SupabaseServerClient } from "@/lib/request-context";
import { QUEUE_PAGE_SIZE, queueMissingPendenciaValue, queueOffset, queuePendenciaFilterValues, queueSlaBucketsForStage, queueStatusOrder, queueStatusRank, type QueuePendenciaFilter, type QueueSlaBucket, type QueueSortDirection, type QueueSortKey, type QueueViewMode } from "@/lib/queue";
import { buildSampleDashboard, sampleEvents, sampleProfile, sampleSalesforceOrders, sampleSentences } from "@/lib/sample-data";
import { getCachedAssignableProfiles } from "@/lib/assignable-profiles-cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canBeAssignedOperationalWork, canCreateOwnEvents, canExportSentences, canManageOperationalData, canViewAllOperationalData } from "@/lib/permissions";
import { isOverdue, statusLabels } from "@/lib/normalization";
import { canonicalizeEventPendencia } from "@/lib/event-taxonomy";
import type { AssignableProfile, DashboardMetrics, DashboardProduction, DashboardStatus, EventResponsibleOption, ManagedUser, ObfImportFileRecord, ObfImportFilesResult, ObfImportStatus, ObfImportStatusMode, ObfImportVerificationRecord, ObfImportVerificationResult, ObfImportVerificationSummary, Profile, ProductionKind, ProductionPeriod, QueueStatusMode, SalesforceOrderGroup, SalesforceOrderQueueSummary, SalesforceOrderRecord, SalesforceOrdersSummary, SentenceEvent, SentenceProcessDuplicate, SentenceRecord, SentenceStatus, WorkflowStage } from "@/lib/types";

const sentenceListSelect = `
  id,
  processo,
  envio_bcc,
  origem_raw,
  origem_normalized,
  tratado,
  tipo_justica_raw,
  cpf_cnpj,
  pendencia,
  responsavel_cumprimento,
  responsavel_qualidade,
  cumprimento_status,
  qualidade_status,
  cumprimento_data,
  qualidade_data,
  data_ultimo_evento
`;

const sentenceListSelectWithoutPendencia = sentenceListSelect.replace(/\n\s+pendencia,/u, "");
const sentenceListSelectWithRawImport = `${sentenceListSelect}, raw_import_payload`;
const sentenceListSelectWithoutPendenciaWithRawImport = `${sentenceListSelectWithoutPendencia}, raw_import_payload`;

const sentenceDetailSelect = `
  id,
  legacy_id_sentenca,
  processo,
  data_publicacao,
  envio_bcc,
  origem_raw,
  origem_normalized,
  tratado,
  tipo_justica_raw,
  tipo_justica_normalized,
  cpf_cnpj,
  autor,
  tipo_cliente,
  uc,
  municipio_raw,
  municipio_normalized,
  tipo_decisao_raw,
  tipo_decisao_normalized,
  observacao,
  valor_multa,
  prazo_fatal,
  tipo_servico_raw,
  responsavel_cumprimento,
  responsavel_qualidade,
  pendencia,
  cumprimento_status,
  qualidade_status,
  cumprimento_data,
  qualidade_data,
  data_ultimo_evento,
  import_warnings
`;

const sentenceDetailSelectWithoutPendencia = sentenceDetailSelect.replace(/\n\s+pendencia,/u, "");
const sentenceDetailSelectWithoutPendenciaWithRawImport = `${sentenceDetailSelectWithoutPendencia}, raw_import_payload`;

const sentenceProcessDuplicateSelect = `
  id,
  legacy_id_sentenca,
  processo,
  autor,
  cpf_cnpj,
  uc,
  municipio_raw,
  tipo_decisao_normalized,
  observacao,
  responsavel_cumprimento,
  responsavel_qualidade,
  pendencia,
  cumprimento_status,
  qualidade_status,
  cumprimento_data,
  qualidade_data,
  data_ultimo_evento
`;

const dashboardSelect = `
  id,
  envio_bcc,
  tratado,
  prazo_fatal,
  responsavel_cumprimento,
  responsavel_qualidade,
  pendencia,
  cumprimento_status,
  qualidade_status,
  cumprimento_data,
  qualidade_data,
  data_ultimo_evento
`;

const salesforceOrderSelect = `
  id,
  import_batch_id,
  import_row_number,
  is_latest,
  processo,
  processo_source,
  owner_name,
  supply_point_number,
  subject,
  salesforce_case_number,
  case_status,
  status_bucket,
  is_open,
  order_number,
  order_state,
  synergia_order_number,
  order_status,
  order_key,
  opened_at,
  created_on,
  reason,
  subreason,
  origin_channel,
  municipality,
  case_observations,
  company_client_id,
  observations_prefixed,
  observations,
  segment_type,
  primary_contact_name,
  created_at
`;

const obfImportVerificationSelect = `
  id,
  row_key,
  arquivo_rel,
  arquivo_size_bytes,
  data_operacional,
  escritorio,
  tipo_fluxo,
  linha_origem,
  processo,
  envio_bcc,
  status_importacao,
  motivo_status,
  destino_tabela,
  imported_record_id,
  import_batch_id,
  importado_em,
  verificado_em,
  created_at,
  updated_at
`;

const dashboardPageSize = 1000;
const eventPendenciaLookupBatchSize = 25;
const dashboardStatusLabels = statusLabels.filter((status): status is Exclude<SentenceStatus, "ENTREGUE"> => status !== "ENTREGUE");
const obfImportStatuses: ObfImportStatus[] = ["importado", "rejeitado", "pendente"];
const obfImportPageSize = 50;

type DashboardEventRow = {
  etapa: string;
  tipo_evento: string;
  data_evento: string;
  responsavel: string | null;
  created_by: string | null;
  performed_by: string | null;
};

type RawDashboardEventRow = Omit<DashboardEventRow, "performed_by">;

type DashboardProductionAggregateRow = {
  person_key: string | null;
  name: string | null;
  is_current_user: boolean | null;
  etapa: string | null;
  today_count: number | string | null;
  day_count?: number | string | null;
  day_delivered_count?: number | string | null;
  day_pending_count?: number | string | null;
  month_count: number | string | null;
  month_delivered_count?: number | string | null;
  month_pending_count?: number | string | null;
  month_occurrence_days?: number | string | null;
  operation_month_occurrence_days?: number | string | null;
};

type QueueSummaryRow = {
  stage: WorkflowStage | string | null;
  kind: string | null;
  value: string | null;
  item_count: number | string | null;
};

type QueueSlaCountRow = {
  bucket: string | null;
  item_count: number | string | null;
};

type QueueItemRow = SentenceRecord & {
  next_cursor?: string | null;
  total_count?: number | string | null;
  order_total?: number | string | null;
  order_open?: number | string | null;
  order_closed?: number | string | null;
  order_unknown?: number | string | null;
  raw_import_payload?: Record<string, unknown> | null;
};

type LatestEventPendenciaRow = {
  id: string;
  sentence_id: string;
  tipo_evento: string | null;
  pendencia: string | null;
  data_evento: string | null;
  created_at: string | null;
};

type SalesforceOrderQueueRow = Pick<
  SalesforceOrderRecord,
  "processo" | "status_bucket" | "is_open" | "order_key" | "order_number" | "synergia_order_number" | "salesforce_case_number" | "import_row_number"
>;

type DashboardMetricsPayload = {
  cumprimentoStatus?: unknown;
  qualidadeStatus?: unknown;
  points?: unknown;
  people?: unknown;
  total?: unknown;
  overdue?: unknown;
  productionRows?: unknown;
};

type DashboardBaseMetrics = Omit<DashboardMetrics, "currentUser" | "production">;

type OperationalQueueSummaryOptions = {
  responsible?: string;
  query?: string;
  slaBucket?: QueueSlaBucket;
  view?: QueueViewMode;
};

export type OperationalQueueSummary = {
  statusCounts: Record<SentenceStatus, number>;
  pendenciaCounts: Record<QueuePendenciaFilter, number>;
  responsible: Array<[string, number]>;
  total: number;
  isManager: boolean;
  lockedResponsible: string | null;
  defaultResponsible: string | null;
};

export type OperationalQueueSlaCounts = Partial<Record<QueueSlaBucket, number>>;

export type OperationalQueueResult = {
  sentences: SentenceRecord[];
  nextCursor: string | null;
  pageSize: number;
  offset: number;
  total: number;
  orderSummariesByProcess: Record<string, SalesforceOrderQueueSummary>;
};

type ObfImportVerificationFilters = {
  status?: ObfImportStatusMode;
  query?: string;
  office?: string;
  from?: string;
  to?: string;
  batchKey?: string;
  cursor?: string;
  pageSize?: number;
};

type ObfImportFileRow = ObfImportFileRecord & {
  total_count?: number | string | null;
};

type ObfImportRow = ObfImportVerificationRecord & {
  total_count?: number | string | null;
};

type ObfImportSummaryRow = {
  kind: "status" | "office" | "rejected_reason" | "latest" | string | null;
  key: string | null;
  value: number | string | null;
  latest_verified_at: string | null;
};

type ObfImportScalarRow = {
  status_importacao?: string | null;
  escritorio?: string | null;
  tipo_fluxo?: string | null;
  motivo_status?: string | null;
  verificado_em?: string | null;
  importado_em?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type ObfImportFilterBuilder<T> = {
  eq: (column: string, value: string) => T;
  gte: (column: string, value: string) => T;
  lt: (column: string, value: string) => T;
  not: (column: string, operator: string, value: string) => T;
  or: (filters: string) => T;
};

type ObfImportOrderBuilder<T> = {
  order: (column: string, options: { ascending: boolean; nullsFirst?: boolean }) => T;
};

type ObfPostgrestError = { message: string; code?: string; details?: string; hint?: string };

type ObfPostgrestResponse = {
  data: unknown;
  error: ObfPostgrestError | null;
  count?: number | null;
};

interface ObfPostgrestBuilder extends PromiseLike<ObfPostgrestResponse> {
  eq: (column: string, value: string) => ObfPostgrestBuilder;
  gte: (column: string, value: string) => ObfPostgrestBuilder;
  lt: (column: string, value: string) => ObfPostgrestBuilder;
  not: (column: string, operator: string, value: string) => ObfPostgrestBuilder;
  or: (filters: string) => ObfPostgrestBuilder;
  order: (column: string, options: { ascending: boolean; nullsFirst?: boolean }) => ObfPostgrestBuilder;
  select: (columns: string, options?: { count?: "exact"; head?: boolean }) => ObfPostgrestBuilder;
  limit: (count: number) => ObfPostgrestBuilder;
  range: (from: number, to: number) => ObfPostgrestBuilder;
}

type ObfImportClient = {
  from: (table: "obf_escritorio_casos_verificados") => ObfPostgrestBuilder;
};

type ObfImportRpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<ObfPostgrestResponse>;
};

export async function getCurrentProfile(): Promise<Profile> {
  const context = await getAppRequestContext();
  return context.profile;
}

export function canManageUsers(profile: Pick<Profile, "active" | "role">) {
  return canManageOperationalData(profile);
}

export function canExportSentenceSpreadsheet(profile: Pick<Profile, "active" | "role">) {
  return canExportSentences(profile);
}

export async function getManagedUsers(): Promise<ManagedUser[]> {
  const context = await getAppRequestContext();
  if (!canManageUsers(context.profile)) return [];
  if (!context.supabase) return [{ ...sampleProfile, created_at: null, updated_at: null }];

  const { data, error } = await context.supabase
    .from("profiles")
    .select("id,email,full_name,role,active,created_at,updated_at")
    .order("created_at", { ascending: false });

  if (error) throwSupabaseError("getManagedUsers", error);
  return (data ?? []) as ManagedUser[];
}

export async function getAssignableProfiles(): Promise<AssignableProfile[]> {
  const context = await getAppRequestContext();
  if (!canManageUsers(context.profile)) return [];
  if (!context.supabase) {
    return [{
      id: sampleProfile.id,
      displayName: sampleProfile.full_name ?? sampleProfile.email,
      email: sampleProfile.email,
      role: sampleProfile.role,
    }];
  }

  const cachedProfiles = await getCachedAssignableProfiles();
  if (cachedProfiles) return cachedProfiles;

  const { data, error } = await context.supabase
    .from("profiles")
    .select("id,email,full_name,role,active")
    .eq("active", true)
    .order("full_name", { ascending: true, nullsFirst: false })
    .order("email", { ascending: true });

  if (error) throwSupabaseError("getAssignableProfiles", error);

  return ((data ?? []) as Profile[])
    .filter(canBeAssignedOperationalWork)
    .map((profile) => ({
      id: profile.id,
      displayName: profile.full_name?.trim() || profile.email,
      email: profile.email,
      role: profile.role,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.email.localeCompare(b.email));
}

export async function getObfImportVerificationSummary(
  options: ObfImportVerificationFilters = {},
): Promise<ObfImportVerificationSummary> {
  const context = await getAppRequestContext();
  if (!context.isManager) return emptyObfImportSummary(false);
  if (!context.supabase) return emptyObfImportSummary(true);

  const filters = normalizeObfImportFilters(options);
  const { data, error } = await obfImportRpc(context).rpc("obf_import_summary_v1", {
    batch_key_arg: filters.batchKey ?? null,
    status_arg: filters.status ?? "all",
    from_arg: filters.from ?? null,
    to_arg: filters.to ?? null,
    query_arg: filters.query ?? null,
    office_arg: filters.office ?? null,
  });

  if (!error) {
    return obfImportSummaryFromRows((data ?? []) as ObfImportSummaryRow[], true);
  }

  if (!isMissingObfRpcError(error)) {
    throwSupabaseError("getObfImportVerificationSummary", error);
  }

  return getLegacyObfImportVerificationSummary(context, filters);
}

export async function getObfImportFiles(
  options: ObfImportVerificationFilters = {},
): Promise<ObfImportFilesResult> {
  const context = await getAppRequestContext();
  const pageSize = clampObfImportPageSize(options.pageSize);
  const offset = importOffset(options.cursor);

  if (!context.isManager) return emptyObfImportFilesResult(false, pageSize, offset);
  if (!context.supabase) return emptyObfImportFilesResult(true, pageSize, offset);

  const filters = normalizeObfImportFilters(options);
  const { data, error } = await obfImportRpc(context).rpc("obf_import_files_v1", {
    status_arg: filters.status ?? "all",
    from_arg: filters.from ?? null,
    to_arg: filters.to ?? null,
    query_arg: filters.query ?? null,
    office_arg: filters.office ?? null,
    limit_arg: pageSize,
    offset_arg: offset,
  });

  if (error) throwSupabaseError("getObfImportFiles", error);

  const files = ((data ?? []) as ObfImportFileRow[]).filter(isObfImportFileRecord);
  const total = files.length ? Number(files[0].total_count ?? files.length) : 0;

  return {
    files,
    nextCursor: offset + pageSize < total ? String(offset + pageSize) : null,
    pageSize,
    offset,
    total,
    isManager: true,
  };
}

async function getLegacyObfImportVerificationSummary(
  context: AppRequestContext,
  filters: ObfImportVerificationFilters,
): Promise<ObfImportVerificationSummary> {
  const statusEntries = await Promise.all(
    obfImportStatuses.map(async (status) => {
      const request = applyObfImportFilters(
        obfImportTable(context)
          .select("id", { count: "exact", head: true })
          .eq("status_importacao", status),
        filters,
        { includeStatus: false },
      );
      const { count, error } = await request;
      if (error) throwSupabaseError(`getObfImportVerificationSummary.status.${status}`, error);
      return [status, count ?? 0] as const;
    }),
  );

  const statusCounts = Object.fromEntries(statusEntries) as Record<ObfImportStatus, number>;
  const [officeRows, reasonRows, latestRows] = await Promise.all([
    selectObfImportScalarRows(context, "escritorio", filters, { includeOffice: false }),
    selectObfImportScalarRows(
      context,
      "motivo_status",
      { ...filters, status: "rejeitado" },
      { includeStatus: true },
    ),
    selectLatestObfImportRows(context, filters),
  ]);
  const latest = latestRows[0];

  return {
    statusCounts,
    total: obfImportStatuses.reduce((sum, status) => sum + statusCounts[status], 0),
    offices: countPresentValues(officeRows, "escritorio"),
    rejectedReasons: countPresentValues(reasonRows, "motivo_status"),
    latestVerifiedAt: latest ? firstPresentTimestamp(latest) : null,
    isManager: true,
  };
}

export async function getObfImportVerificationItems(
  options: ObfImportVerificationFilters = {},
): Promise<ObfImportVerificationResult> {
  const context = await getAppRequestContext();
  const pageSize = clampObfImportPageSize(options.pageSize);
  const offset = importOffset(options.cursor);

  if (!context.isManager) return emptyObfImportResult(false, pageSize, offset);
  if (!context.supabase) return emptyObfImportResult(true, pageSize, offset);

  const filters = normalizeObfImportFilters(options);
  const { data: rpcData, error: rpcError } = await obfImportRpc(context).rpc("obf_import_rows_v1", {
    batch_key_arg: filters.batchKey ?? null,
    status_arg: filters.status ?? "all",
    from_arg: filters.from ?? null,
    to_arg: filters.to ?? null,
    query_arg: filters.query ?? null,
    office_arg: filters.office ?? null,
    limit_arg: pageSize,
    offset_arg: offset,
  });

  if (!rpcError) {
    const records = ((rpcData ?? []) as ObfImportRow[]).filter((row): row is ObfImportRow => isObfImportVerificationRecord(row));
    const total = records.length ? Number(records[0].total_count ?? records.length) : 0;

    return {
      records,
      nextCursor: offset + pageSize < total ? String(offset + pageSize) : null,
      pageSize,
      offset,
      total,
      isManager: true,
    };
  }

  if (!isMissingObfRpcError(rpcError)) {
    throwSupabaseError("getObfImportVerificationItems", rpcError);
  }

  let request = obfImportTable(context)
    .select(obfImportVerificationSelect, { count: "exact" });

  request = applyObfImportFilters(request, filters);
  request = applyLegacyObfBatchFilter(request, filters);
  request = applyObfImportOrdering(request).range(offset, offset + pageSize - 1);

  const { data, error, count } = await request;
  if (error) throwSupabaseError("getObfImportVerificationItems", error);

  const total = count ?? 0;
  return {
    records: ((data ?? []) as ObfImportVerificationRecord[]).filter(isObfImportVerificationRecord),
    nextCursor: offset + pageSize < total ? String(offset + pageSize) : null,
    pageSize,
    offset,
    total,
    isManager: true,
  };
}

export async function getEventResponsibleOptions(): Promise<EventResponsibleOption[]> {
  const context = await getAppRequestContext();
  if (!context.supabase) return [toEventResponsibleOption(sampleProfile)];

  const cachedProfiles = await getCachedAssignableProfiles();
  if (cachedProfiles) {
    return cachedProfiles
      .filter((profile) => profile.role !== "analista")
      .map(({ id, displayName }) => ({ id, displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  const admin = createSupabaseAdminClient();
  const client = admin ?? context.supabase;
  const { data, error } = await client
    .from("profiles")
    .select("id,email,full_name,role,active")
    .eq("active", true)
    .order("full_name", { ascending: true, nullsFirst: false })
    .order("email", { ascending: true });

  if (error) throwSupabaseError("getEventResponsibleOptions", error);

  return ((data ?? []) as Profile[])
    .filter(canBeAssignedOperationalWork)
    .map(toEventResponsibleOption)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function toEventResponsibleOption(profile: Pick<Profile, "id" | "email" | "full_name">): EventResponsibleOption {
  return {
    id: profile.id,
    displayName: profile.full_name?.trim() || profile.email,
  };
}

export async function getSentence(id: string): Promise<SentenceRecord | null> {
  const context = await getAppRequestContext();
  if (!context.supabase) return sampleSentences.find((sentence) => sentence.id === id) ?? null;

  const { data, error } = await context.supabase.from("sentences").select(sentenceDetailSelect).eq("id", id).maybeSingle();
  if (error && isMissingSentencePendenciaError(error)) {
    const fallback = await context.supabase
      .from("sentences")
      .select(sentenceDetailSelectWithoutPendenciaWithRawImport)
      .eq("id", id)
      .maybeSingle();

    if (fallback.error) throwSupabaseError("getSentence.fallback", fallback.error);
    if (!fallback.data) return null;

    return addDerivedPendenciaToSentence(context, fallback.data as unknown as QueueItemRow);
  }
  if (error) throwSupabaseError("getSentence", error);
  return data as SentenceRecord | null;
}

export async function getSentenceProcessDuplicates(sentenceId: string): Promise<SentenceProcessDuplicate[]> {
  const context = await getAppRequestContext();
  if (!context.supabase) return getLocalSentenceProcessDuplicates(sentenceId);

  const { data, error } = await context.supabase.rpc("sentence_process_duplicates", { sentence_id_arg: sentenceId });

  if (!error) return normalizeSentenceProcessDuplicates((data ?? []) as SentenceProcessDuplicate[]);
  if (!isMissingRpcError(error)) throwSupabaseError("getSentenceProcessDuplicates", error);

  return getFallbackSentenceProcessDuplicates(context, sentenceId);
}

export async function getSentenceEvents(sentenceId: string): Promise<SentenceEvent[]> {
  const context = await getAppRequestContext();
  if (!context.supabase) {
    return sampleEvents
      .filter((event) => event.sentence_id === sentenceId)
      .map((event) => ({ ...event, canEdit: canEditSentenceEvent(context, event) }));
  }

  const { data, error } = await context.supabase
    .from("sentence_events")
    .select("*")
    .eq("sentence_id", sentenceId)
    .order("data_evento", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throwSupabaseError("getSentenceEvents", error);
  return ((data ?? []) as SentenceEvent[]).map((event) => ({
    ...event,
    canEdit: canEditSentenceEvent(context, event),
  }));
}

function canEditSentenceEvent(context: AppRequestContext, event: Pick<SentenceEvent, "created_by">) {
  return context.isManager || (canCreateOwnEvents(context.profile) && Boolean(context.userId && event.created_by === context.userId));
}

export async function getSalesforceOrdersForProcess(processo: string): Promise<SalesforceOrdersSummary> {
  const context = await getAppRequestContext();
  if (!context.supabase) {
    return summarizeSalesforceOrders(sampleSalesforceOrders.filter((order) => order.processo === processo));
  }

  const client = createSupabaseAdminClient() ?? context.supabase;
  const { data, error } = await client
    .from("salesforce_orders")
    .select(salesforceOrderSelect)
    .eq("is_latest", true)
    .eq("processo", processo)
    .order("opened_at", { ascending: false, nullsFirst: false })
    .order("import_row_number", { ascending: false });

  if (error) throwSupabaseError("getSalesforceOrdersForProcess", error);
  return summarizeSalesforceOrders((data ?? []) as SalesforceOrderRecord[]);
}

export async function getSalesforceOrderQueueSummaries(processos: string[]): Promise<Record<string, SalesforceOrderQueueSummary>> {
  const uniqueProcessos = uniquePresent(processos);
  if (uniqueProcessos.length === 0) return {};

  const context = await getAppRequestContext();
  if (!context.supabase) {
    return summarizeSalesforceOrderQueueRows(
      sampleSalesforceOrders.filter((order) => order.is_latest && order.processo && uniqueProcessos.includes(order.processo)),
    );
  }

  const { data, error } = await context.supabase
    .from("salesforce_orders")
    .select("processo,status_bucket,is_open,order_key,order_number,synergia_order_number,salesforce_case_number,import_row_number")
    .eq("is_latest", true)
    .in("processo", uniqueProcessos);

  if (error) throwSupabaseError("getSalesforceOrderQueueSummaries", error);
  return summarizeSalesforceOrderQueueRows((data ?? []) as SalesforceOrderQueueRow[]);
}

function getLocalSentenceProcessDuplicates(sentenceId: string): SentenceProcessDuplicate[] {
  const current = sampleSentences.find((sentence) => sentence.id === sentenceId);
  if (!current) return [];

  const rows = sampleSentences.filter((sentence) => sentence.processo === current.processo);
  const orderSummary = summarizeSalesforceOrderQueueRows(
    sampleSalesforceOrders.filter((order) => order.is_latest && order.processo === current.processo),
  )[current.processo];

  return normalizeSentenceProcessDuplicates(
    rows.map((sentence) => ({
      ...sentence,
      is_current: sentence.id === sentenceId,
      event_count: sampleEvents.filter((event) => event.sentence_id === sentence.id).length,
      order_total: orderSummary?.totalOrders ?? 0,
      order_open: orderSummary?.openOrders ?? 0,
      order_closed: orderSummary?.closedOrders ?? 0,
      order_unknown: orderSummary?.unknownOrders ?? 0,
    })),
  );
}

async function getFallbackSentenceProcessDuplicates(
  context: AppRequestContext,
  sentenceId: string,
): Promise<SentenceProcessDuplicate[]> {
  const { data: current, error: currentError } = await context.supabase!
    .from("sentences")
    .select("id,processo")
    .eq("id", sentenceId)
    .maybeSingle();

  if (currentError) throwSupabaseError("getSentenceProcessDuplicates.current", currentError);
  if (!current?.processo) return [];

  const client = createSupabaseAdminClient() ?? context.supabase!;
  const { data: sentences, error: sentenceError } = await client
    .from("sentences")
    .select(sentenceProcessDuplicateSelect)
    .eq("processo", current.processo)
    .order("data_ultimo_evento", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true });

  if (sentenceError) throwSupabaseError("getSentenceProcessDuplicates.sentences", sentenceError);

  const rows = (sentences ?? []) as SentenceRecord[];
  const sentenceIds = rows.map((sentence) => sentence.id);
  const eventCounts = new Map<string, number>();
  if (sentenceIds.length > 0) {
    const { data: events, error: eventError } = await client
      .from("sentence_events")
      .select("sentence_id")
      .in("sentence_id", sentenceIds);

    if (eventError) throwSupabaseError("getSentenceProcessDuplicates.events", eventError);
    for (const event of (events ?? []) as Array<{ sentence_id: string }>) {
      eventCounts.set(event.sentence_id, (eventCounts.get(event.sentence_id) ?? 0) + 1);
    }
  }

  const orderSummary = (await getSalesforceOrderQueueSummaries([current.processo]))[current.processo];

  return normalizeSentenceProcessDuplicates(
    rows.map((sentence) => ({
      ...sentence,
      is_current: sentence.id === sentenceId,
      event_count: eventCounts.get(sentence.id) ?? 0,
      order_total: orderSummary?.totalOrders ?? 0,
      order_open: orderSummary?.openOrders ?? 0,
      order_closed: orderSummary?.closedOrders ?? 0,
      order_unknown: orderSummary?.unknownOrders ?? 0,
    })),
  );
}

function normalizeSentenceProcessDuplicates(rows: SentenceProcessDuplicate[]): SentenceProcessDuplicate[] {
  return rows.map((row) => ({
    ...row,
    event_count: toNumber(row.event_count),
    order_total: toNumber(row.order_total),
    order_open: toNumber(row.order_open),
    order_closed: toNumber(row.order_closed),
    order_unknown: toNumber(row.order_unknown),
  }));
}

function isMissingRpcError(error: { code?: string; message?: string }) {
  return error.code === "PGRST202"
    || error.code === "42883"
    || /could not find the function/i.test(error.message ?? "");
}

function isMissingSentencePendenciaError(error: { message?: string; code?: string; details?: string } | null | undefined) {
  if (!error) return false;
  if (error.code === "42703") return true;
  const text = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return text.includes("sentences.pendencia") || (text.includes("pendencia") && text.includes("schema cache"));
}

function isQueueRpcCompatibilityError(error: { code?: string; message?: string; details?: string } | null | undefined) {
  if (!error) return false;
  return isMissingRpcError(error) || isMissingSentencePendenciaError(error);
}

function isMissingAffectsOperationalStateError(error: { message?: string; code?: string; details?: string } | null | undefined) {
  if (!error) return false;
  if (error.code === "42703") return true;
  const text = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return text.includes("affects_operational_state") && (text.includes("does not exist") || text.includes("schema cache"));
}

const dashboardDateParamPattern = /^\d{4}-\d{2}-\d{2}$/;

function parseDashboardDateParam(value: string | undefined, fallback: Date) {
  if (!value || !dashboardDateParamPattern.test(value)) return fallback;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : fallback;
}

function resolveDashboardRange(from?: string, to?: string) {
  const today = new Date();
  const monthStart = startOfMonth(today);
  const start = parseDashboardDateParam(from, monthStart);
  const end = parseDashboardDateParam(to, today);

  if (start.getTime() > end.getTime()) {
    return { today, monthStart, start: monthStart, end: today };
  }

  return { today, monthStart, start, end };
}

export async function getDashboardMetrics(from?: string, to?: string): Promise<DashboardMetrics> {
  const context = await getAppRequestContext();
  if (!context.supabase) return buildSampleDashboard(context.profile);

  const { today, monthStart, start, end } = resolveDashboardRange(from, to);
  const productionClient = (createSupabaseAdminClient() ?? context.supabase) as SupabaseServerClient;
  const todayKey = format(today, "yyyy-MM-dd");
  const fromKey = format(start, "yyyy-MM-dd");
  const toKey = format(end, "yyyy-MM-dd");

  const { data: v2Data, error: v2Error } = await context.supabase.rpc("dashboard_metrics_v2", {
    from_arg: fromKey,
    to_arg: toKey,
    today_arg: todayKey,
  });

  if (!v2Error && v2Data) {
    const metrics = normalizeDashboardMetrics(v2Data);
    const productionRows = normalizeDashboardProductionRows((v2Data as DashboardMetricsPayload).productionRows);
    if (metrics && productionRows) {
      if (context.canViewAllData && !context.isManager) {
        const productionEvents = await getDashboardEvents(productionClient, monthStart, today);
        return addDashboardProduction(metrics, context.profile, context.responsibleName, productionEvents, today);
      }
      return addDashboardProductionFromRows(metrics, context.profile, context.responsibleName, productionRows);
    }
  }

  if (v2Error && !isMissingRpcError(v2Error)) {
    throwSupabaseError("getDashboardMetrics.v2", v2Error);
  }

  const metricsPromise = context.supabase.rpc("dashboard_metrics", {
    from_arg: fromKey,
    to_arg: toKey,
  });
  const productionRowsPromise = getDashboardProductionRows(context.supabase, today);
  const [{ data, error }, productionRows] = await Promise.all([metricsPromise, productionRowsPromise]);

  const metrics = !error ? normalizeDashboardMetrics(data) : null;
  if (metrics) {
    if (productionRows) {
      return addDashboardProductionFromRows(metrics, context.profile, context.responsibleName, productionRows);
    }

    const productionEvents = await getDashboardEvents(productionClient, monthStart, today);
    return addDashboardProduction(metrics, context.profile, context.responsibleName, productionEvents, today);
  }

  const [sentences, events] = await Promise.all([
    getDashboardSentences(context.supabase),
    getDashboardEvents(context.supabase, start, end),
  ]);

  const dashboard = buildDashboard(sentences, events, start, end);
  if (productionRows) {
    return addDashboardProductionFromRows(dashboard, context.profile, context.responsibleName, productionRows);
  }

  const productionEvents = await getDashboardEvents(productionClient, monthStart, today);
  return addDashboardProduction(dashboard, context.profile, context.responsibleName, productionEvents, today);
}

export async function getOperationalQueueSummary(stage: WorkflowStage, options: OperationalQueueSummaryOptions = {}): Promise<OperationalQueueSummary> {
  const context = await getAppRequestContext();
  const defaultResponsible = context.canViewAllData ? null : context.responsibleName;
  const responsible = normalizeQueueResponsible(options.responsible);
  const statusResponsibleFilter = queueResponsibleForDataAccess(context, responsible);
  const query = options.query?.trim() || undefined;
  const slaBucket = options.slaBucket;
  const view = options.view ?? "operational";
  const shouldUseQueueRpc = context.isManager || !context.canViewAllData;

  if (context.supabase && shouldUseQueueRpc) {
    const { data, error } = await context.supabase.rpc("operational_queue_summary_v2", {
      stage_arg: stage,
      responsible_arg: responsible ?? null,
      q_arg: query ?? null,
      sla_bucket_arg: slaBucket ?? null,
      view_arg: view,
    });

    if (!error && data) {
      return summarizeOperationalQueueCounts(data as QueueSummaryRow[], stage, context.canViewAllData, defaultResponsible);
    }

    if (error && !isQueueRpcCompatibilityError(error)) {
      throwSupabaseError(`getOperationalQueueSummary.v2.${stage}`, error);
    }
  }

  if (view === "dashboard-status") {
    if (!context.supabase) {
      const rows = filterDashboardStatusQueueRows(sampleSentences, { stage, statusMode: "ALL", query, responsible: "ALL", slaBucket }, context);
      return summarizeOperationalQueueRows(
        rows,
        stage,
        context.canViewAllData,
        defaultResponsible,
        statusResponsibleFilter,
      );
    }

    if (slaBucket) {
      return getRemoteDashboardStatusQueueSummary(context, stage, responsible, query, defaultResponsible, slaBucket);
    }

    if (shouldUseQueueRpc) {
      const { data, error } = await context.supabase.rpc("dashboard_status_queue_summary", {
        stage_arg: stage,
        responsible_arg: responsible ?? null,
        q_arg: query ?? null,
      });

      if (!error && data) {
        const pendenciaCounts = await getRemoteQueuePendenciaCounts(context, stage, responsible, query, view);
        return summarizeOperationalQueueCounts(data as QueueSummaryRow[], stage, context.canViewAllData, defaultResponsible, pendenciaCounts);
      }
    }

    return getRemoteDashboardStatusQueueSummary(context, stage, responsible, query, defaultResponsible);
  }

  if (!context.supabase) {
    const rows = filterOperationalQueueRows(sampleSentences, { stage, statusMode: "ALL", query, responsible: "ALL", slaBucket }, context);
    return summarizeOperationalQueueRows(
      rows,
      stage,
      context.canViewAllData,
      defaultResponsible,
      statusResponsibleFilter,
    );
  }

  if (slaBucket) {
    const rows = await getRemoteOperationalQueueSummaryRows(context, stage, query, slaBucket);
    return summarizeOperationalQueueRows(rows, stage, context.canViewAllData, defaultResponsible, statusResponsibleFilter);
  }

  if (shouldUseQueueRpc) {
    const { data, error } = await context.supabase.rpc("operational_queue_summary", {
      stage_arg: stage,
      responsible_arg: responsible ?? null,
      q_arg: query ?? null,
    });
    if (!error && data) {
      const pendenciaCounts = await getRemoteQueuePendenciaCounts(context, stage, responsible, query, view);
      return summarizeOperationalQueueCounts(data as QueueSummaryRow[], stage, context.canViewAllData, defaultResponsible, pendenciaCounts);
    }

    const legacy = await context.supabase.rpc("operational_queue_summary");
    if (!legacy.error && legacy.data) {
      const pendenciaCounts = await getRemoteQueuePendenciaCounts(context, stage, responsible, query, view);
      return summarizeOperationalQueueCounts(legacy.data as QueueSummaryRow[], stage, context.canViewAllData, defaultResponsible, pendenciaCounts);
    }
  }

  const rows = await getRemoteOperationalQueueSummaryRows(context, stage, query);
  return summarizeOperationalQueueRows(rows, stage, context.canViewAllData, defaultResponsible, statusResponsibleFilter);
}

export async function getOperationalQueueItems(options: {
  stage: WorkflowStage;
  statusMode: QueueStatusMode;
  pendencia?: QueuePendenciaFilter;
  responsible?: string;
  query?: string;
  cursor?: string;
  pageSize?: number;
  slaBucket?: QueueSlaBucket;
  sort?: QueueSortKey;
  sortDirection?: QueueSortDirection;
  view?: QueueViewMode;
}): Promise<OperationalQueueResult> {
  const context = await getAppRequestContext();
  const pageSize = clampPageSize(options.pageSize);
  const offset = queueOffset(options.cursor);
  const fetchSize = pageSize + 1;
  const view = options.view ?? "operational";

  if (!context.supabase) {
    const baseRows = view === "dashboard-status"
      ? filterDashboardStatusQueueRows(sampleSentences, options, context)
      : filterOperationalQueueRows(sampleSentences, options, context);
    const filtered = sortOperationalQueueRows(baseRows, options.stage, options.sort, options.sortDirection);
    const rows = filtered.slice(offset, offset + fetchSize);
    return pageOperationalQueueRows(rows, pageSize, offset, filtered.length);
  }

  if (context.canViewAllData && !context.isManager) {
    if (view === "dashboard-status") {
      const dashboardRows = options.pendencia
        ? await getRemoteQueueRowsByDerivedPendencia(context, { ...options, view }, fetchSize, offset)
        : await getRemoteDashboardStatusQueueRows(context, options, fetchSize, offset);
      return pageOperationalQueueRows(dashboardRows.rows, pageSize, offset, dashboardRows.total);
    }

    const fallback = options.pendencia
      ? await getRemoteQueueRowsByDerivedPendencia(context, { ...options, view }, fetchSize, offset)
      : await getRemoteOperationalQueueRows(context, options, fetchSize, offset);
    const orderSummariesByProcess = await getFallbackQueueOrderSummaries(options.stage, fallback.rows as QueueItemRow[], pageSize);
    return pageOperationalQueueRows(fallback.rows, pageSize, offset, fallback.total, undefined, orderSummariesByProcess);
  }

  const queueArgsV4 = {
    stage_arg: options.stage,
    status_mode_arg: options.statusMode,
    responsible_arg: options.responsible ?? null,
    q_arg: options.query ?? null,
    cursor_arg: options.cursor ?? null,
    page_size_arg: pageSize,
    sort_key_arg: options.sort ?? null,
    sort_direction_arg: options.sortDirection ?? "asc",
    sla_bucket_arg: options.slaBucket ?? null,
    pendencia_arg: options.pendencia ?? null,
    view_arg: view,
  };

  const { data: v4Data, error: v4Error } = await context.supabase.rpc("operational_queue_items_v4", queueArgsV4);

  if (!v4Error && v4Data) {
    const rows = v4Data as unknown as QueueItemRow[];
    return pageOperationalQueueRows(rows, pageSize, offset, 0, readQueueNextCursor(rows), readQueueOrderSummaries(rows));
  }

  if (v4Error && !isQueueRpcCompatibilityError(v4Error)) {
    throwSupabaseError(`getOperationalQueueItems.v4.${options.stage}`, v4Error);
  }

  if (view === "dashboard-status") {
    if (options.slaBucket || options.pendencia) {
      const dashboardRows = options.pendencia
        ? await getRemoteQueueRowsByDerivedPendencia(context, { ...options, view }, fetchSize, offset)
        : await getRemoteDashboardStatusQueueRows(context, options, fetchSize, offset);
      return pageOperationalQueueRows(dashboardRows.rows, pageSize, offset, dashboardRows.total);
    }

    const dashboardRows = await getRemoteDashboardStatusQueueRows(context, options, fetchSize, offset);
    return pageOperationalQueueRows(dashboardRows.rows, pageSize, offset, dashboardRows.total);
  }

  if (options.slaBucket || options.pendencia) {
    const fallback = options.pendencia
      ? await getRemoteQueueRowsByDerivedPendencia(context, { ...options, view }, fetchSize, offset)
      : await getRemoteOperationalQueueRows(context, options, fetchSize, offset);
    const orderSummariesByProcess = await getFallbackQueueOrderSummaries(options.stage, fallback.rows as QueueItemRow[], pageSize);
    return pageOperationalQueueRows(fallback.rows, pageSize, offset, fallback.total, undefined, orderSummariesByProcess);
  }

  const queueArgs = {
    stage_arg: options.stage,
    status_mode_arg: options.statusMode,
    responsible_arg: options.responsible ?? null,
    q_arg: options.query ?? null,
    cursor_arg: options.cursor ?? null,
    page_size_arg: pageSize,
    sort_key_arg: options.sort ?? null,
    sort_direction_arg: options.sortDirection ?? "asc",
  };

  const { data: v3Data, error: v3Error } = await context.supabase.rpc("operational_queue_items_v3", queueArgs);

  if (!v3Error && v3Data) {
    const rows = v3Data as unknown as QueueItemRow[];
    return pageOperationalQueueRows(rows, pageSize, offset, 0, readQueueNextCursor(rows), readQueueOrderSummaries(rows));
  }

  const { data, error } = await context.supabase.rpc("operational_queue_items_v2", queueArgs);

  if (!error && data) {
    const rows = data as unknown as QueueItemRow[];
    const orderSummariesByProcess = await getFallbackQueueOrderSummaries(options.stage, rows, pageSize);
    return pageOperationalQueueRows(rows, pageSize, offset, readQueueTotal(rows), readQueueNextCursor(rows), orderSummariesByProcess);
  }

  const legacy = await context.supabase.rpc("operational_queue_items", {
    stage_arg: options.stage,
    status_mode_arg: options.statusMode,
    responsible_arg: options.responsible ?? null,
    q_arg: options.query ?? null,
    cursor_arg: String(offset),
    page_size_arg: fetchSize,
    sort_key_arg: options.sort ?? null,
    sort_direction_arg: options.sortDirection ?? "asc",
  });

  if (!legacy.error && legacy.data) {
    const rows = legacy.data as unknown as QueueItemRow[];
    const orderSummariesByProcess = await getFallbackQueueOrderSummaries(options.stage, rows, pageSize);
    return pageOperationalQueueRows(rows, pageSize, offset, readQueueTotal(rows), undefined, orderSummariesByProcess);
  }

  const fallback = await getRemoteOperationalQueueRows(context, options, fetchSize, offset);
  const orderSummariesByProcess = await getFallbackQueueOrderSummaries(options.stage, fallback.rows as QueueItemRow[], pageSize);
  return pageOperationalQueueRows(fallback.rows, pageSize, offset, fallback.total, undefined, orderSummariesByProcess);
}

export async function getOperationalQueueSlaCounts(
  stage: WorkflowStage,
  options: {
    statusMode: QueueStatusMode;
    pendencia?: QueuePendenciaFilter;
    responsible?: string;
    query?: string;
    view?: QueueViewMode;
  },
): Promise<OperationalQueueSlaCounts> {
  const context = await getAppRequestContext();
  const query = options.query?.trim() || undefined;
  const view = options.view ?? "operational";

  if (!context.supabase) {
    const rows = view === "dashboard-status"
      ? filterDashboardStatusQueueRows(sampleSentences, { stage, statusMode: options.statusMode, pendencia: options.pendencia, query, responsible: options.responsible }, context)
      : filterOperationalQueueRows(sampleSentences, { stage, statusMode: options.statusMode, pendencia: options.pendencia, query, responsible: options.responsible }, context);

    return countQueueSlaBuckets(rows, stage);
  }

  if (context.isManager || !context.canViewAllData) {
    const { data, error } = await context.supabase.rpc("operational_queue_sla_counts_v1", {
      stage_arg: stage,
      status_mode_arg: options.statusMode,
      responsible_arg: options.responsible ?? null,
      q_arg: query ?? null,
      pendencia_arg: options.pendencia ?? null,
      view_arg: view,
    });

    if (!error && data) {
      return slaCountsFromRows(stage, data as QueueSlaCountRow[]);
    }

    if (error && !isQueueRpcCompatibilityError(error)) {
      throwSupabaseError(`getOperationalQueueSlaCounts.v1.${stage}`, error);
    }
  }

  if (options.pendencia) {
    const rows = await getRemotePendingRowsWithDerivedPendencia(context, {
      stage,
      statusMode: options.statusMode,
      responsible: options.responsible,
      query,
      view,
    });
    return countQueueSlaBuckets(rows.filter((row) => queuePendenciaMatches(row, options.pendencia)), stage);
  }

  const entries = await Promise.all(queueSlaBucketsForStage(stage).map(async (bucket) => {
    const builder = view === "dashboard-status" ? buildDashboardStatusQueueRequest : buildRemoteQueueRequest;
    const { count, error } = await builder(
      context,
      stage,
      options.statusMode,
      options.responsible,
      query,
      "id",
      { count: "exact", head: true },
      bucket,
      options.pendencia,
    );

    if (error) throwSupabaseError(`getOperationalQueueSlaCounts.${stage}.${bucket}`, error);
    return [bucket, count ?? 0] as const;
  }));

  return Object.fromEntries(entries) as OperationalQueueSlaCounts;
}

function applyResponsibleScope<T extends { eq: (column: string, value: string) => T }>(
  request: T,
  context: AppRequestContext,
  column: "responsavel_cumprimento" | "responsavel_qualidade",
  responsible?: string,
) {
  const responsibleFilter = queueResponsibleForDataAccess(context, responsible);
  if (responsibleFilter) return request.eq(column, responsibleFilter);
  return request;
}

function normalizeQueueResponsible(responsible: string | null | undefined) {
  const normalized = responsible?.trim();
  return normalized || undefined;
}

function queueResponsibleForDataAccess(context: AppRequestContext, responsible: string | null | undefined) {
  const normalized = normalizeQueueResponsible(responsible);
  if (normalized === "ALL") return undefined;
  if (normalized) return normalized;
  return context.canViewAllData ? undefined : context.responsibleName;
}

function summarizeOperationalQueueCounts(
  rows: QueueSummaryRow[],
  stage: WorkflowStage,
  isManager: boolean,
  defaultResponsible: string | null,
  pendenciaCounts: Record<QueuePendenciaFilter, number> = emptyPendenciaCounts(),
): OperationalQueueSummary {
  const statusCounts = emptyStatusCounts();
  const responsible = new Map<string, number>();

  for (const row of rows) {
    if (row.stage !== stage || !row.value) continue;
    const count = Number(row.item_count ?? 0);
    if (row.kind === "status" && isSentenceStatus(row.value)) statusCounts[row.value] = count;
    if (row.kind === "responsible") responsible.set(row.value, count);
    if (row.kind === "pendencia" && queuePendenciaFilterValues.includes(row.value as QueuePendenciaFilter)) {
      pendenciaCounts[row.value as QueuePendenciaFilter] = count;
    }
  }

  return buildOperationalQueueSummary(statusCounts, pendenciaCounts, responsible, isManager, defaultResponsible);
}

function summarizeOperationalQueueRows(
  sentences: Partial<SentenceRecord>[],
  stage: WorkflowStage,
  isManager: boolean,
  defaultResponsible: string | null,
  responsibleFilter?: string,
): OperationalQueueSummary {
  const statusCounts = emptyStatusCounts();
  const pendenciaCounts = emptyPendenciaCounts();
  const responsible = new Map<string, number>();
  const normalizedResponsibleFilter = responsibleFilter && responsibleFilter !== "ALL" ? responsibleFilter : null;

  for (const sentence of sentences) {
    const statusValue = stage === "CUMPRIMENTO" ? sentence.cumprimento_status : sentence.qualidade_status;
    const responsibleValue = stage === "CUMPRIMENTO" ? sentence.responsavel_cumprimento : sentence.responsavel_qualidade;
    const includeInStatusCount = !normalizedResponsibleFilter || responsibleValue === normalizedResponsibleFilter;
    if (statusValue && includeInStatusCount) statusCounts[statusValue] += 1;
    if (statusValue === "PENDENTE" && includeInStatusCount) {
      const pendencia = queuePendenciaForSentence(sentence);
      if (pendencia) pendenciaCounts[pendencia] += 1;
    }
    if (responsibleValue) responsible.set(responsibleValue, (responsible.get(responsibleValue) ?? 0) + 1);
  }

  return buildOperationalQueueSummary(statusCounts, pendenciaCounts, responsible, isManager, defaultResponsible);
}

function buildOperationalQueueSummary(
  statusCounts: Record<SentenceStatus, number>,
  pendenciaCounts: Record<QueuePendenciaFilter, number>,
  responsible: Map<string, number>,
  isManager: boolean,
  defaultResponsible: string | null,
): OperationalQueueSummary {
  return {
    statusCounts,
    pendenciaCounts,
    responsible: [...responsible.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    total: statusLabels.reduce((sum, status) => sum + statusCounts[status], 0),
    isManager,
    lockedResponsible: null,
    defaultResponsible,
  };
}

function emptyStatusCounts(): Record<SentenceStatus, number> {
  return Object.fromEntries(statusLabels.map((status) => [status, 0])) as Record<SentenceStatus, number>;
}

function emptyPendenciaCounts(): Record<QueuePendenciaFilter, number> {
  return Object.fromEntries(queuePendenciaFilterValues.map((pendencia) => [pendencia, 0])) as Record<QueuePendenciaFilter, number>;
}

function isSentenceStatus(value: string): value is SentenceStatus {
  return statusLabels.includes(value as SentenceStatus);
}

function emptyDashboardStatusCounts(): DashboardStatus {
  return Object.fromEntries(dashboardStatusLabels.map((status) => [status, 0])) as DashboardStatus;
}

function countDashboardStatus(counts: DashboardStatus, status: SentenceStatus | null | undefined) {
  if (status && status !== "ENTREGUE") counts[status] += 1;
}

function isActiveDashboardSentence(sentence: SentenceRecord) {
  return sentence.qualidade_status !== "ENTREGUE";
}

async function getDashboardSentences(supabase: SupabaseServerClient): Promise<SentenceRecord[]> {
  const rows: SentenceRecord[] = [];

  for (let from = 0; ; from += dashboardPageSize) {
    const { data, error } = await supabase
      .from("sentences")
      .select(dashboardSelect)
      .order("id", { ascending: true })
      .range(from, from + dashboardPageSize - 1);

    if (error) throwSupabaseError("getDashboardMetrics.sentences", error);
    rows.push(...((data ?? []) as SentenceRecord[]));
    if (!data || data.length < dashboardPageSize) break;
  }

  return rows;
}

async function getDashboardEvents(supabase: SupabaseServerClient, start: Date, end: Date): Promise<DashboardEventRow[]> {
  const rows: RawDashboardEventRow[] = [];
  const startKey = format(start, "yyyy-MM-dd");
  const endKey = format(end, "yyyy-MM-dd");

  for (let from = 0; ; from += dashboardPageSize) {
    const { data, error } = await supabase
      .from("sentence_events")
      .select("etapa,tipo_evento,data_evento,responsavel,created_by")
      .gte("data_evento", startKey)
      .lte("data_evento", endKey)
      .order("data_evento", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, from + dashboardPageSize - 1);

    if (error) throwSupabaseError("getDashboardMetrics.events", error);
    rows.push(...((data ?? []) as RawDashboardEventRow[]));
    if (!data || data.length < dashboardPageSize) break;
  }

  const namesByProfileId = await getProfileDisplayNames(supabase, rows.map((row) => row.created_by).filter(Boolean) as string[]);
  return rows.map((row) => ({
    ...row,
    performed_by: row.created_by ? namesByProfileId.get(row.created_by) ?? row.responsavel : row.responsavel,
  }));
}

async function getDashboardProductionRows(
  supabase: SupabaseServerClient,
  today: Date,
): Promise<DashboardProductionAggregateRow[] | null> {
  const { data, error } = await supabase.rpc("dashboard_production_metrics", {
    today_arg: format(today, "yyyy-MM-dd"),
  });

  if (error || !data) return null;
  return normalizeDashboardProductionRows(data);
}

function normalizeDashboardProductionRows(value: unknown): DashboardProductionAggregateRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value as DashboardProductionAggregateRow[];
  if (rows.some((row) => row.month_occurrence_days == null || row.operation_month_occurrence_days == null)) {
    return null;
  }
  if (rows.some((row) => (
    row.day_delivered_count == null
    || row.day_pending_count == null
    || row.month_delivered_count == null
    || row.month_pending_count == null
  ))) {
    return null;
  }

  return rows;
}

async function getProfileDisplayNames(supabase: SupabaseServerClient, profileIds: string[]) {
  const names = new Map<string, string>();
  const uniqueIds = [...new Set(profileIds)];

  for (let from = 0; from < uniqueIds.length; from += dashboardPageSize) {
    const ids = uniqueIds.slice(from, from + dashboardPageSize);
    if (ids.length === 0) continue;

    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,full_name")
      .in("id", ids);

    if (error) throwSupabaseError("getDashboardMetrics.eventProfiles", error);

    for (const profile of (data ?? []) as Pick<Profile, "id" | "email" | "full_name">[]) {
      const displayName = profile.full_name?.trim() || profile.email;
      if (displayName) names.set(profile.id, displayName);
    }
  }

  return names;
}

function clampPageSize(value: number | undefined) {
  if (!value) return QUEUE_PAGE_SIZE;
  return Math.min(Math.max(Math.floor(value), 1), 100);
}

function pageOperationalQueueRows(
  rows: QueueItemRow[],
  pageSize: number,
  offset: number,
  total: number,
  nextCursor?: string | null,
  orderSummariesByProcess: Record<string, SalesforceOrderQueueSummary> = {},
): OperationalQueueResult {
  const sentences = rows.slice(0, pageSize) as SentenceRecord[];
  return {
    sentences,
    nextCursor: nextCursor ?? (rows.length > pageSize ? String(offset + pageSize) : null),
    pageSize,
    offset,
    total,
    orderSummariesByProcess,
  };
}

function readQueueTotal(rows: QueueItemRow[]) {
  if (rows.length === 0) return 0;
  return Number(rows[0].total_count ?? 0);
}

function readQueueNextCursor(rows: QueueItemRow[]) {
  return rows.find((row) => typeof row.next_cursor === "string" && row.next_cursor.length > 0)?.next_cursor ?? null;
}

function readQueueOrderSummaries(rows: QueueItemRow[]) {
  const summaries: Record<string, SalesforceOrderQueueSummary> = {};

  for (const row of rows) {
    const processo = row.processo?.trim();
    if (!processo) continue;

    const totalOrders = Number(row.order_total ?? 0);
    if (!Number.isFinite(totalOrders) || totalOrders <= 0) continue;

    summaries[processo] = {
      totalOrders,
      openOrders: toNumber(row.order_open),
      closedOrders: toNumber(row.order_closed),
      unknownOrders: toNumber(row.order_unknown),
    };
  }

  return summaries;
}

async function getFallbackQueueOrderSummaries(stage: WorkflowStage, rows: QueueItemRow[], pageSize: number) {
  if (stage !== "QUALIDADE") return {};
  return getSalesforceOrderQueueSummaries(rows.slice(0, pageSize).map((row) => row.processo));
}

async function getRemoteOperationalQueueSummaryRows(context: AppRequestContext, stage: WorkflowStage, query?: string, slaBucket?: QueueSlaBucket) {
  const select = stage === "CUMPRIMENTO"
    ? "id,cumprimento_status,responsavel_cumprimento,pendencia,raw_import_payload"
    : "id,qualidade_status,responsavel_qualidade,pendencia,raw_import_payload";
  const selectWithoutPendencia = stage === "CUMPRIMENTO"
    ? "id,cumprimento_status,responsavel_cumprimento,raw_import_payload"
    : "id,qualidade_status,responsavel_qualidade,raw_import_payload";
  const { rows, includesSentencePendencia } = await selectRemoteQueueRowsWithOptionalPendencia(
    context,
    { stage, statusMode: "ALL", responsible: "ALL", query, view: "operational", slaBucket },
    select,
    selectWithoutPendencia,
    `getOperationalQueueSummary.${stage}`,
  );

  return attachDerivedQueuePendencias(context, rows, includesSentencePendencia);
}

async function getRemoteQueuePendenciaCounts(
  context: AppRequestContext,
  stage: WorkflowStage,
  responsible: string | undefined,
  query: string | undefined,
  view: QueueViewMode,
  slaBucket?: QueueSlaBucket,
): Promise<Record<QueuePendenciaFilter, number>> {
  const counts = emptyPendenciaCounts();
  const rows = await getRemotePendingRowsWithDerivedPendencia(context, {
    stage,
    statusMode: "PENDENTE",
    responsible,
    query,
    view,
    slaBucket,
  });

  for (const row of rows) {
    const pendencia = queuePendenciaForSentence(row);
    if (pendencia) counts[pendencia] += 1;
  }

  return counts;
}

async function getRemotePendingRowsWithDerivedPendencia(
  context: AppRequestContext,
  options: {
    stage: WorkflowStage;
    statusMode: QueueStatusMode;
    responsible?: string;
    query?: string;
    view: QueueViewMode;
    slaBucket?: QueueSlaBucket;
  },
) {
  const { rows, includesSentencePendencia } = await selectRemoteQueueRowsWithOptionalPendencia(
    context,
    options,
    "id,pendencia,raw_import_payload",
    "id,raw_import_payload",
    `getRemotePendingRowsWithDerivedPendencia.${options.stage}`,
  );

  return attachDerivedQueuePendencias(context, rows, includesSentencePendencia);
}

async function getRemoteQueueRowsByDerivedPendencia(
  context: AppRequestContext,
  options: {
    stage: WorkflowStage;
    statusMode: QueueStatusMode;
    pendencia?: QueuePendenciaFilter;
    responsible?: string;
    query?: string;
    slaBucket?: QueueSlaBucket;
    sort?: QueueSortKey;
    sortDirection?: QueueSortDirection;
    view: QueueViewMode;
  },
  fetchSize: number,
  offset: number,
) {
  const { rows: baseRows, includesSentencePendencia } = await selectRemoteQueueRowsWithOptionalPendencia(
    context,
    {
      stage: options.stage,
      statusMode: options.statusMode,
      responsible: options.responsible,
      query: options.query,
      view: options.view,
      slaBucket: options.slaBucket,
    },
    sentenceListSelectWithRawImport,
    sentenceListSelectWithoutPendenciaWithRawImport,
    `getRemoteQueueRowsByDerivedPendencia.${options.stage}`,
  );
  const rows = await attachDerivedQueuePendencias(context, baseRows, includesSentencePendencia);
  const filtered = options.pendencia ? rows.filter((row) => queuePendenciaMatches(row, options.pendencia)) : rows;
  const sorted = sortOperationalQueueRows(filtered, options.stage, options.sort, options.sortDirection) as QueueItemRow[];

  return {
    rows: sorted.slice(offset, offset + fetchSize),
    total: filtered.length,
  };
}

async function selectRemoteQueueRowsWithOptionalPendencia(
  context: AppRequestContext,
  options: {
    stage: WorkflowStage;
    statusMode: QueueStatusMode;
    responsible?: string;
    query?: string;
    view: QueueViewMode;
    slaBucket?: QueueSlaBucket;
  },
  selectWithPendencia: string,
  selectWithoutPendencia: string,
  errorContext: string,
  limit = 10000,
): Promise<{ rows: QueueItemRow[]; includesSentencePendencia: boolean }> {
  const builder = options.view === "dashboard-status" ? buildDashboardStatusQueueRequest : buildRemoteQueueRequest;
  const result = await selectRemoteQueueRowsByRange(
    () => builder(
      context,
      options.stage,
      options.statusMode,
      options.responsible,
      options.query,
      selectWithPendencia,
      undefined,
      options.slaBucket,
    ),
    limit,
  );

  const { error } = result;
  if (!error) return { rows: result.rows, includesSentencePendencia: true };
  if (!isMissingSentencePendenciaError(error)) throwSupabaseError(errorContext, error);

  const fallback = await selectRemoteQueueRowsByRange(
    () => builder(
      context,
      options.stage,
      options.statusMode,
      options.responsible,
      options.query,
      selectWithoutPendencia,
      undefined,
      options.slaBucket,
    ),
    limit,
  );

  if (fallback.error) throwSupabaseError(`${errorContext}.fallback`, fallback.error);
  return { rows: fallback.rows, includesSentencePendencia: false };
}

async function selectRemoteQueueRowsByRange(
  buildRequest: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string; details?: string; hint?: string } | null }> },
  limit: number,
) {
  const pageSize = 1000;
  const rows: QueueItemRow[] = [];

  for (let from = 0; from < limit; from += pageSize) {
    const to = Math.min(from + pageSize - 1, limit - 1);
    const { data, error } = await buildRequest().range(from, to);
    if (error) return { rows, error };

    const pageRows = (data ?? []) as unknown as QueueItemRow[];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
  }

  return { rows, error: null };
}

async function selectRemoteQueuePageWithOptionalPendencia(
  context: AppRequestContext,
  options: {
    stage: WorkflowStage;
    statusMode: QueueStatusMode;
    pendencia?: QueuePendenciaFilter;
    responsible?: string;
    query?: string;
    slaBucket?: QueueSlaBucket;
    sort?: QueueSortKey;
    sortDirection?: QueueSortDirection;
    view: QueueViewMode;
  },
  stage: WorkflowStage,
  from: number,
  size: number,
  errorContext: string,
): Promise<{ rows: QueueItemRow[]; includesSentencePendencia: boolean }> {
  const builder = options.view === "dashboard-status" ? buildDashboardStatusQueueRequest : buildRemoteQueueRequest;
  const buildRequest = (select: string) => applyQueuePostgrestOrder(
    builder(
      context,
      options.stage,
      options.statusMode,
      options.responsible,
      options.query,
      select,
      undefined,
      options.slaBucket,
      options.pendencia,
    ),
    stage,
    options.sort,
    options.sortDirection,
  ).range(from, from + size - 1);

  const { data, error } = await buildRequest(sentenceListSelect);
  if (!error) return { rows: (data ?? []) as unknown as QueueItemRow[], includesSentencePendencia: true };
  if (!isMissingSentencePendenciaError(error)) throwSupabaseError(errorContext, error);

  const fallback = await buildRequest(sentenceListSelectWithoutPendencia);
  if (fallback.error) throwSupabaseError(`${errorContext}.fallback`, fallback.error);
  return { rows: (fallback.data ?? []) as unknown as QueueItemRow[], includesSentencePendencia: false };
}

async function attachDerivedQueuePendencias(
  context: AppRequestContext,
  rows: QueueItemRow[],
  includesSentencePendencia: boolean,
) {
  if (rows.length === 0) return rows;

  const eventPendencias = await getLatestEventPendencias(context, rows.map((row) => row.id));

  return rows.map((row) => {
    const sentencePendencia = includesSentencePendencia ? canonicalQueuePendencia(row.pendencia) : null;
    const eventPendencia = eventPendencias.get(row.id) ?? null;

    return {
      ...row,
      pendencia: sentencePendencia ?? eventPendencia,
    };
  });
}

async function addDerivedPendenciaToSentence(context: AppRequestContext, row: QueueItemRow): Promise<SentenceRecord> {
  const [sentence] = await attachDerivedQueuePendencias(context, [row], false);
  return sentence as SentenceRecord;
}

async function getLatestEventPendencias(
  context: AppRequestContext,
  sentenceIds: string[],
) {
  const pendencias = new Map<string, QueuePendenciaFilter>();
  const seen = new Set<string>();
  const uniqueIds = [...new Set(sentenceIds.filter(Boolean))];
  const client = createSupabaseAdminClient() ?? context.supabase!;

  for (let from = 0; from < uniqueIds.length; from += eventPendenciaLookupBatchSize) {
    const ids = uniqueIds.slice(from, from + eventPendenciaLookupBatchSize);
    if (ids.length === 0) continue;

    const request = client
      .from("sentence_events")
      .select("id,sentence_id,tipo_evento,pendencia,data_evento,created_at,affects_operational_state")
      .in("sentence_id", ids)
      .eq("affects_operational_state", true)
      .order("data_evento", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });

    const initial = await request;
    let data = initial.data as LatestEventPendenciaRow[] | null;
    let error = initial.error;

    if (error && isMissingAffectsOperationalStateError(error)) {
      const fallback = await client
        .from("sentence_events")
        .select("id,sentence_id,tipo_evento,pendencia,data_evento,created_at")
        .in("sentence_id", ids)
        .order("data_evento", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false });

      data = fallback.data as LatestEventPendenciaRow[] | null;
      error = fallback.error;
    }

    if (error) continue;

    for (const row of (data ?? []) as LatestEventPendenciaRow[]) {
      if (seen.has(row.sentence_id)) continue;
      seen.add(row.sentence_id);
      if (row.tipo_evento !== "PENDENTE") continue;

      const pendencia = canonicalQueuePendencia(row.pendencia);
      if (pendencia) pendencias.set(row.sentence_id, pendencia);
    }
  }

  return pendencias;
}

async function getRemoteDashboardStatusQueueSummary(
  context: AppRequestContext,
  stage: WorkflowStage,
  responsible: string | undefined,
  query: string | undefined,
  defaultResponsible: string | null,
  slaBucket?: QueueSlaBucket,
): Promise<OperationalQueueSummary> {
  const statusCounts = emptyStatusCounts();
  const responsibleColumn = stage === "CUMPRIMENTO" ? "responsavel_cumprimento" : "responsavel_qualidade";
  const statusCountEntries = await Promise.all(
    dashboardStatusLabels.map(async (status) => {
      const { count, error } = await buildDashboardStatusQueueRequest(
        context,
        stage,
        status,
        responsible,
        query,
        "id",
        { count: "exact", head: true },
        slaBucket,
      );

      if (error) throwSupabaseError(`getDashboardStatusQueueSummary.count.${stage}.${status}`, error);
      return [status, count ?? 0] as const;
    }),
  );

  for (const [status, count] of statusCountEntries) {
    statusCounts[status] = count;
  }

  const { data, error } = await buildDashboardStatusQueueRequest(
    context,
    stage,
    "ALL",
    "ALL",
    query,
    responsibleColumn,
    undefined,
    slaBucket,
  ).limit(10000);
  if (error) throwSupabaseError(`getDashboardStatusQueueSummary.responsible.${stage}`, error);

  const responsibleCounts = new Map<string, number>();
  for (const row of (data ?? []) as Partial<SentenceRecord>[]) {
    const responsibleValue = stage === "CUMPRIMENTO" ? row.responsavel_cumprimento : row.responsavel_qualidade;
    if (responsibleValue) responsibleCounts.set(responsibleValue, (responsibleCounts.get(responsibleValue) ?? 0) + 1);
  }

  const pendenciaCounts = await getRemoteQueuePendenciaCounts(context, stage, responsible, query, "dashboard-status", slaBucket);
  return buildOperationalQueueSummary(statusCounts, pendenciaCounts, responsibleCounts, context.canViewAllData, defaultResponsible);
}

async function getRemoteOperationalQueueRows(
  context: AppRequestContext,
  options: {
    stage: WorkflowStage;
    statusMode: QueueStatusMode;
    pendencia?: QueuePendenciaFilter;
    responsible?: string;
    query?: string;
    slaBucket?: QueueSlaBucket;
    sort?: QueueSortKey;
    sortDirection?: QueueSortDirection;
  },
  fetchSize: number,
  offset: number,
) {
  const statuses = options.statusMode === "ALL" ? queueStatusOrder : [options.statusMode];
  const rows: SentenceRecord[] = [];
  let total = 0;
  let skipped = offset;

  for (const status of statuses) {
    const countRequest = buildRemoteQueueRequest(context, options.stage, status, options.responsible, options.query, "id", { count: "exact", head: true }, options.slaBucket, options.pendencia);
    const { count, error: countError } = await countRequest;
    if (countError) throwSupabaseError(`getOperationalQueueItems.count.${options.stage}`, countError);

    const statusCount = count ?? 0;
    total += statusCount;
    if (skipped >= statusCount) {
      skipped -= statusCount;
      continue;
    }

    const needed = fetchSize - rows.length;
    const { rows: dataRows } = await selectRemoteQueuePageWithOptionalPendencia(
      context,
      { ...options, statusMode: status, view: "operational" },
      options.stage,
      skipped,
      needed,
      `getOperationalQueueItems.${options.stage}`,
    );
    rows.push(...dataRows);
    skipped = 0;
    if (rows.length >= fetchSize) break;
  }

  return { rows, total };
}

async function getRemoteDashboardStatusQueueRows(
  context: AppRequestContext,
  options: {
    stage: WorkflowStage;
    statusMode: QueueStatusMode;
    pendencia?: QueuePendenciaFilter;
    responsible?: string;
    query?: string;
    slaBucket?: QueueSlaBucket;
    sort?: QueueSortKey;
    sortDirection?: QueueSortDirection;
  },
  fetchSize: number,
  offset: number,
) {
  const statuses = options.statusMode === "ALL"
    ? queueStatusOrder.filter((status) => status !== "ENTREGUE")
    : [options.statusMode];
  const rows: SentenceRecord[] = [];
  let total = 0;
  let skipped = offset;

  for (const status of statuses) {
    const countRequest = buildDashboardStatusQueueRequest(context, options.stage, status, options.responsible, options.query, "id", { count: "exact", head: true }, options.slaBucket, options.pendencia);
    const { count, error: countError } = await countRequest;
    if (countError) throwSupabaseError(`getDashboardStatusQueueItems.count.${options.stage}`, countError);

    const statusCount = count ?? 0;
    total += statusCount;
    if (skipped >= statusCount) {
      skipped -= statusCount;
      continue;
    }

    const needed = fetchSize - rows.length;
    const { rows: dataRows } = await selectRemoteQueuePageWithOptionalPendencia(
      context,
      { ...options, statusMode: status, view: "dashboard-status" },
      options.stage,
      skipped,
      needed,
      `getDashboardStatusQueueItems.${options.stage}`,
    );
    rows.push(...dataRows);
    skipped = 0;
    if (rows.length >= fetchSize) break;
  }

  return { rows, total };
}

function buildRemoteQueueRequest(
  context: AppRequestContext,
  stage: WorkflowStage,
  statusMode: QueueStatusMode,
  responsible: string | undefined,
  query: string | undefined,
  select: string,
  options?: { count: "exact"; head: true },
  slaBucket?: QueueSlaBucket,
  pendencia?: QueuePendenciaFilter,
) {
  let request = context.supabase!.from("sentences").select(select, options);

  if (stage === "CUMPRIMENTO") {
    if (statusMode !== "ALL") request = request.eq("cumprimento_status", statusMode);
    request = applyResponsibleScope(request, context, "responsavel_cumprimento", responsible);
  } else {
    request = request.eq("cumprimento_status", "ENTREGUE");
    if (statusMode !== "ALL") request = request.eq("qualidade_status", statusMode);
    request = applyResponsibleScope(request, context, "responsavel_qualidade", responsible);
  }

  const term = sanitizeSearchTerm(query);
  if (term) request = request.or(`processo.ilike.%${term}%,autor.ilike.%${term}%,cpf_cnpj.ilike.%${term}%,uc.ilike.%${term}%`);

  request = applyQueuePendenciaFilter(request, statusMode, pendencia);
  return applyQueueSlaBucketFilter(request, stage, slaBucket);
}

function buildDashboardStatusQueueRequest(
  context: AppRequestContext,
  stage: WorkflowStage,
  statusMode: QueueStatusMode,
  responsible: string | undefined,
  query: string | undefined,
  select: string,
  options?: { count: "exact"; head: true },
  slaBucket?: QueueSlaBucket,
  pendencia?: QueuePendenciaFilter,
) {
  let request = context.supabase!.from("sentences").select(select, options);
  const statusColumn = stage === "CUMPRIMENTO" ? "cumprimento_status" : "qualidade_status";

  if (statusMode === "ALL") {
    request = request.neq(statusColumn, "ENTREGUE");
  } else {
    request = request.eq(statusColumn, statusMode);
  }

  if (stage === "CUMPRIMENTO") {
    request = applyResponsibleScope(request, context, "responsavel_cumprimento", responsible);
  } else {
    request = applyResponsibleScope(request, context, "responsavel_qualidade", responsible);
  }

  const term = sanitizeSearchTerm(query);
  if (term) request = request.or(`processo.ilike.%${term}%,autor.ilike.%${term}%,cpf_cnpj.ilike.%${term}%,uc.ilike.%${term}%`);

  request = applyQueuePendenciaFilter(request, statusMode, pendencia);
  return applyQueueSlaBucketFilter(request, stage, slaBucket);
}

function applyQueuePendenciaFilter<T extends {
  eq: (column: string, value: string) => T;
  is: (column: string, value: null) => T;
}>(
  request: T,
  statusMode: QueueStatusMode,
  pendencia: QueuePendenciaFilter | undefined,
) {
  if (statusMode !== "PENDENTE" || !pendencia) return request;
  if (pendencia === queueMissingPendenciaValue) return request.is("pendencia", null);
  return request.eq("pendencia", pendencia);
}

function applyQueueSlaBucketFilter<T extends {
  eq: (column: string, value: string) => T;
  gte: (column: string, value: string) => T;
  lte: (column: string, value: string) => T;
}>(
  request: T,
  stage: WorkflowStage,
  slaBucket: QueueSlaBucket | undefined,
) {
  if (!slaBucket) return request;

  const column = stage === "CUMPRIMENTO" ? "tratado" : "data_ultimo_evento";
  if (stage === "QUALIDADE") {
    switch (slaBucket) {
      case "0_7":
        return request.gte(column, queueSlaBucketDate(7)).lte(column, queueSlaBucketDate(0));
      case "8_14":
        return request.gte(column, queueSlaBucketDate(14)).lte(column, queueSlaBucketDate(8));
      case "15_30":
        return request.gte(column, queueSlaBucketDate(30)).lte(column, queueSlaBucketDate(15));
      case "31_60":
        return request.gte(column, queueSlaBucketDate(60)).lte(column, queueSlaBucketDate(31));
      case "61_PLUS":
        return request.lte(column, queueSlaBucketDate(61));
      default:
        return request;
    }
  }

  if (slaBucket === "5_PLUS") return request.lte(column, queueSlaBucketDate(5));
  return request.eq(column, queueSlaBucketDate(Number(slaBucket)));
}

function queueSlaBucketDate(daysAgo: number) {
  return format(subDays(new Date(), daysAgo), "yyyy-MM-dd");
}

function applyQueuePostgrestOrder<T extends { order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => T }>(
  request: T,
  stage: WorkflowStage,
  sort: QueueSortKey | undefined,
  direction: QueueSortDirection = "asc",
) {
  const ascending = direction !== "desc";
  const responsibleColumn = stage === "CUMPRIMENTO" ? "responsavel_cumprimento" : "responsavel_qualidade";
  const stageDateColumn = stage === "CUMPRIMENTO" ? "envio_bcc" : "cumprimento_data";
  const slaDateColumn = stage === "CUMPRIMENTO" ? "tratado" : "data_ultimo_evento";

  switch (sort) {
    case "responsible":
      return request.order(responsibleColumn, { ascending, nullsFirst: false }).order("id", { ascending: true });
    case "processo":
      return request.order("processo", { ascending, nullsFirst: false }).order("id", { ascending: true });
    case "envio_bcc":
      return request.order("envio_bcc", { ascending, nullsFirst: false }).order("id", { ascending: true });
    case "stage_date":
      return request.order(stageDateColumn, { ascending, nullsFirst: false }).order("id", { ascending: true });
    case "data_ultimo_evento":
      return request.order("data_ultimo_evento", { ascending, nullsFirst: false }).order("id", { ascending: true });
    case "origem":
      return request.order("origem_normalized", { ascending, nullsFirst: false }).order("id", { ascending: true });
    case "sla":
      return request.order(slaDateColumn, { ascending: !ascending, nullsFirst: false }).order("id", { ascending: true });
    default:
      return request.order("data_ultimo_evento", { ascending: true, nullsFirst: false }).order("id", { ascending: true });
  }
}

function summarizeSalesforceOrders(rows: SalesforceOrderRecord[]): SalesforceOrdersSummary {
  const groups = groupSalesforceOrders(rows);
  const latestImportedAt = rows.reduce<string | null>((latest, row) => {
    if (!row.created_at) return latest;
    if (!latest || row.created_at > latest) return row.created_at;
    return latest;
  }, null);

  return {
    totalRows: rows.length,
    openRows: rows.filter(isSalesforceOrderOpen).length,
    closedRows: rows.filter((row) => normalizeSalesforceStatus(row.case_status) === "FECHADO").length,
    canceledRows: rows.filter((row) => normalizeSalesforceStatus(row.case_status) === "CANCELADO").length,
    unknownRows: rows.filter((row) => row.status_bucket === "unknown").length,
    latestImportedAt,
    groups,
  };
}

function groupSalesforceOrders(rows: SalesforceOrderRecord[]): SalesforceOrderGroup[] {
  const grouped = new Map<string, SalesforceOrderRecord[]>();

  for (const row of rows) {
    const key = salesforceOrderGroupKey(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  return [...grouped.entries()]
    .map(([key, groupRows]) => {
      const sortedRows = sortSalesforceOrderRows(groupRows);
      const latestRow = sortedRows[0]!;
      return {
        key,
        displayOrderNumber: latestRow.order_number || latestRow.synergia_order_number || latestRow.order_key || "Sem ordem",
        rows: sortedRows,
        rowCount: sortedRows.length,
        isOpen: sortedRows.some(isSalesforceOrderOpen),
        latestRow,
        orderStates: uniquePresent(sortedRows.map((row) => row.order_state)),
        orderStatuses: uniquePresent(sortedRows.map((row) => row.order_status)),
      };
    })
    .sort((a, b) => {
      if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
      const aDate = a.latestRow.opened_at ?? "";
      const bDate = b.latestRow.opened_at ?? "";
      return bDate.localeCompare(aDate) || a.displayOrderNumber.localeCompare(b.displayOrderNumber);
    });
}

function sortSalesforceOrderRows(rows: SalesforceOrderRecord[]) {
  return [...rows].sort((a, b) => {
    const dateDelta = (b.opened_at ?? "").localeCompare(a.opened_at ?? "");
    if (dateDelta !== 0) return dateDelta;
    return b.import_row_number - a.import_row_number;
  });
}

function summarizeSalesforceOrderQueueRows(rows: SalesforceOrderQueueRow[]): Record<string, SalesforceOrderQueueSummary> {
  const rowsByProcess = new Map<string, SalesforceOrderQueueRow[]>();

  for (const row of rows) {
    if (!row.processo) continue;
    rowsByProcess.set(row.processo, [...(rowsByProcess.get(row.processo) ?? []), row]);
  }

  return Object.fromEntries(
    [...rowsByProcess.entries()].map(([processo, processRows]) => {
      const groups = new Map<string, SalesforceOrderQueueRow[]>();
      for (const row of processRows) {
        const key = salesforceOrderGroupKey(row);
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }

      const summary: SalesforceOrderQueueSummary = {
        totalOrders: groups.size,
        openOrders: 0,
        closedOrders: 0,
        unknownOrders: 0,
      };

      for (const groupRows of groups.values()) {
        if (groupRows.some(isSalesforceOrderOpen)) {
          summary.openOrders += 1;
        } else if (groupRows.some((row) => row.status_bucket === "unknown")) {
          summary.unknownOrders += 1;
        } else {
          summary.closedOrders += 1;
        }
      }

      return [processo, summary];
    }),
  );
}

function salesforceOrderGroupKey(row: Pick<SalesforceOrderRecord, "order_key" | "order_number" | "synergia_order_number" | "salesforce_case_number" | "import_row_number">) {
  return row.order_key?.trim()
    || row.order_number?.trim()
    || row.synergia_order_number?.trim()
    || (row.salesforce_case_number ? `caso-${row.salesforce_case_number}` : `linha-${row.import_row_number}`);
}

function isSalesforceOrderOpen(row: Pick<SalesforceOrderRecord, "is_open" | "status_bucket">) {
  return row.is_open || row.status_bucket === "open";
}

function uniquePresent(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function normalizeSalesforceStatus(value: string | null | undefined) {
  return value
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase() ?? "";
}

function throwSupabaseError(context: string, error: { message: string; code?: string; details?: string; hint?: string }): never {
  const metadata = [
    error.code ? `code=${error.code}` : null,
    error.details ? `details=${error.details}` : null,
    error.hint ? `hint=${error.hint}` : null,
  ].filter(Boolean);
  throw new Error(`${context} failed: ${error.message}${metadata.length ? ` (${metadata.join("; ")})` : ""}`);
}

function emptyObfImportSummary(isManager: boolean): ObfImportVerificationSummary {
  return {
    statusCounts: { importado: 0, rejeitado: 0, pendente: 0 },
    total: 0,
    offices: [],
    rejectedReasons: [],
    latestVerifiedAt: null,
    isManager,
  };
}

function emptyObfImportResult(isManager: boolean, pageSize: number, offset: number): ObfImportVerificationResult {
  return {
    records: [],
    nextCursor: null,
    pageSize,
    offset,
    total: 0,
    isManager,
  };
}

function emptyObfImportFilesResult(isManager: boolean, pageSize: number, offset: number): ObfImportFilesResult {
  return {
    files: [],
    nextCursor: null,
    pageSize,
    offset,
    total: 0,
    isManager,
  };
}

function obfImportTable(context: AppRequestContext) {
  return (context.supabase as unknown as ObfImportClient).from("obf_escritorio_casos_verificados");
}

function obfImportRpc(context: AppRequestContext) {
  return context.supabase as unknown as ObfImportRpcClient;
}

function normalizeObfImportFilters(options: ObfImportVerificationFilters): ObfImportVerificationFilters {
  return {
    status: isObfImportStatusMode(options.status) ? options.status : "all",
    query: sanitizeObfImportSearchTerm(options.query),
    office: options.office?.trim() || undefined,
    from: sanitizeObfImportDate(options.from),
    to: sanitizeObfImportDate(options.to),
    batchKey: sanitizeObfImportBatchKey(options.batchKey),
    cursor: options.cursor,
    pageSize: options.pageSize,
  };
}

function isObfImportStatusMode(value: unknown): value is ObfImportStatusMode {
  return value === "all" || isObfImportStatus(value);
}

function isObfImportStatus(value: unknown): value is ObfImportStatus {
  return typeof value === "string" && obfImportStatuses.includes(value as ObfImportStatus);
}

function isObfImportVerificationRecord(row: ObfImportVerificationRecord): row is ObfImportVerificationRecord {
  return isObfImportStatus(row.status_importacao);
}

function isObfImportFileRecord(row: ObfImportFileRow): row is ObfImportFileRow {
  return typeof row.batch_key === "string" && row.batch_key.length > 0;
}

function sanitizeObfImportSearchTerm(value: string | undefined) {
  const sanitized = value?.replace(/[%(),]/g, " ").replace(/\s+/g, " ").trim();
  return sanitized ? sanitized.slice(0, 120) : undefined;
}

function sanitizeObfImportDate(value: string | undefined) {
  const date = value?.trim();
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

function sanitizeObfImportBatchKey(value: string | undefined) {
  const batchKey = value?.trim();
  if (!batchKey) return undefined;
  if (/^batch:[0-9a-fA-F-]{36}$/.test(batchKey)) return batchKey.toLowerCase();
  if (/^file:[0-9a-fA-F]{32}$/.test(batchKey)) return batchKey.toLowerCase();
  return undefined;
}

function importOffset(cursor: string | undefined) {
  if (!cursor) return 0;
  const value = Number.parseInt(cursor, 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clampObfImportPageSize(value: number | undefined) {
  if (!value) return obfImportPageSize;
  return Math.max(1, Math.min(100, Math.floor(value)));
}

function applyObfImportFilters<T extends ObfImportFilterBuilder<T>>(
  request: T,
  filters: ObfImportVerificationFilters,
  scope: { includeStatus?: boolean; includeOffice?: boolean } = {},
) {
  let scoped = request;
  const includeStatus = scope.includeStatus ?? true;
  const includeOffice = scope.includeOffice ?? true;

  scoped = scoped.not("tipo_fluxo", "ilike", "%TUTELA%");

  if (includeStatus && filters.status && filters.status !== "all") {
    scoped = scoped.eq("status_importacao", filters.status);
  }

  if (includeOffice && filters.office) {
    scoped = scoped.eq("escritorio", filters.office);
  }

  const dateRange = obfImportVerificationDateRange(filters);
  if (dateRange.from) {
    scoped = scoped.gte("created_at", dateRange.from);
  }

  if (dateRange.toExclusive) {
    scoped = scoped.lt("created_at", dateRange.toExclusive);
  }

  if (filters.query) {
    const term = filters.query;
    scoped = scoped.or(
      `processo.ilike.%${term}%,escritorio.ilike.%${term}%,tipo_fluxo.ilike.%${term}%,arquivo_rel.ilike.%${term}%,motivo_status.ilike.%${term}%,row_key.ilike.%${term}%`,
    );
  }

  return scoped;
}

function applyLegacyObfBatchFilter<T extends ObfImportFilterBuilder<T>>(request: T, filters: ObfImportVerificationFilters) {
  if (!filters.batchKey?.startsWith("batch:")) return request;
  return request.eq("import_batch_id", filters.batchKey.slice("batch:".length));
}

function obfImportVerificationDateRange(filters: ObfImportVerificationFilters) {
  const from = filters.from;
  const to = filters.to;
  if (!from && !to) {
    return {};
  }

  const start = from && to && from > to ? to : from;
  const end = from && to && from > to ? from : to;

  return {
    from: start ? saoPauloStartTimestamp(start) : undefined,
    toExclusive: end ? saoPauloStartTimestamp(addDaysToDateKey(end, 1)) : undefined,
  };
}

function addDaysToDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function saoPauloStartTimestamp(dateKey: string) {
  return `${dateKey}T00:00:00-03:00`;
}

function applyObfImportOrdering<T extends ObfImportOrderBuilder<T>>(request: T) {
  return request
    .order("verificado_em", { ascending: false, nullsFirst: false })
    .order("importado_em", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true });
}

async function selectObfImportScalarRows(
  context: AppRequestContext,
  select: "escritorio" | "motivo_status",
  filters: ObfImportVerificationFilters,
  scope: { includeStatus?: boolean; includeOffice?: boolean } = {},
) {
  let request = obfImportTable(context)
    .select(select)
    .limit(10000);

  request = applyObfImportFilters(request, filters, scope);
  const { data, error } = await request;
  if (error) throwSupabaseError(`selectObfImportScalarRows.${select}`, error);
  return (data ?? []) as ObfImportScalarRow[];
}

async function selectLatestObfImportRows(
  context: AppRequestContext,
  filters: ObfImportVerificationFilters,
) {
  let request = obfImportTable(context)
    .select("verificado_em,importado_em,updated_at,created_at")
    .limit(1);

  request = applyObfImportFilters(request, filters, { includeStatus: false });
  request = applyObfImportOrdering(request);
  const { data, error } = await request;
  if (error) throwSupabaseError("selectLatestObfImportRows", error);
  return (data ?? []) as ObfImportScalarRow[];
}

function obfImportSummaryFromRows(rows: ObfImportSummaryRow[], isManager: boolean): ObfImportVerificationSummary {
  const statusCounts: Record<ObfImportStatus, number> = { importado: 0, rejeitado: 0, pendente: 0 };
  const offices: Array<[string, number]> = [];
  const rejectedReasons: Array<[string, number]> = [];
  let latestVerifiedAt: string | null = null;

  for (const row of rows) {
    const key = row.key?.trim();
    const value = Number(row.value ?? 0);

    if (row.kind === "status" && isObfImportStatus(key)) {
      statusCounts[key] = Number.isFinite(value) ? value : 0;
      continue;
    }

    if (row.kind === "office" && key) {
      offices.push([key, Number.isFinite(value) ? value : 0]);
      continue;
    }

    if (row.kind === "rejected_reason" && key) {
      rejectedReasons.push([key, Number.isFinite(value) ? value : 0]);
      continue;
    }

    if (row.kind === "latest" && row.latest_verified_at) {
      latestVerifiedAt = row.latest_verified_at;
    }
  }

  return {
    statusCounts,
    total: obfImportStatuses.reduce((sum, status) => sum + statusCounts[status], 0),
    offices: offices.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR")),
    rejectedReasons: rejectedReasons.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR")),
    latestVerifiedAt,
    isManager,
  };
}

function isMissingObfRpcError(error: ObfPostgrestError) {
  return error.code === "PGRST202" || /function .*obf_import_.* does not exist/i.test(error.message);
}

function countPresentValues<K extends keyof ObfImportScalarRow>(rows: ObfImportScalarRow[], key: K): Array<[string, number]> {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const value = typeof row[key] === "string" ? row[key]?.trim() : "";
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
}

function firstPresentTimestamp(row: ObfImportScalarRow) {
  return row.verificado_em ?? row.importado_em ?? row.updated_at ?? row.created_at ?? null;
}

function filterOperationalQueueRows(
  sentences: SentenceRecord[],
  options: { stage: WorkflowStage; statusMode?: QueueStatusMode; pendencia?: QueuePendenciaFilter; query?: string; responsible?: string; slaBucket?: QueueSlaBucket },
  context: AppRequestContext,
) {
  const query = options.query?.toUpperCase();
  const statusMode = options.statusMode ?? "EM ANDAMENTO";
  const responsibleFilter = queueResponsibleForDataAccess(context, options.responsible);

  return sentences.filter((sentence) => {
    if (query) {
      const haystack = [sentence.processo, sentence.autor, sentence.cpf_cnpj, sentence.uc].join(" ").toUpperCase();
      if (!haystack.includes(query)) return false;
    }

    if (options.stage === "QUALIDADE" && sentence.cumprimento_status !== "ENTREGUE") return false;

    const statusValue = options.stage === "CUMPRIMENTO" ? sentence.cumprimento_status : sentence.qualidade_status;
    const responsibleValue = options.stage === "CUMPRIMENTO" ? sentence.responsavel_cumprimento : sentence.responsavel_qualidade;

    if (statusMode !== "ALL" && statusValue !== statusMode) return false;
    if (statusMode === "PENDENTE" && !queuePendenciaMatches(sentence, options.pendencia)) return false;

    if (!queueSlaBucketMatches(sentence, options.stage, options.slaBucket)) return false;

    if (responsibleFilter) return responsibleValue === responsibleFilter;

    return true;
  });
}

function filterDashboardStatusQueueRows(
  sentences: SentenceRecord[],
  options: { stage: WorkflowStage; statusMode?: QueueStatusMode; pendencia?: QueuePendenciaFilter; query?: string; responsible?: string; slaBucket?: QueueSlaBucket },
  context: AppRequestContext,
) {
  const query = options.query?.toUpperCase();
  const statusMode = options.statusMode ?? "EM ANDAMENTO";
  const responsibleFilter = queueResponsibleForDataAccess(context, options.responsible);

  return sentences.filter((sentence) => {
    if (query) {
      const haystack = [sentence.processo, sentence.autor, sentence.cpf_cnpj, sentence.uc].join(" ").toUpperCase();
      if (!haystack.includes(query)) return false;
    }

    const statusValue = options.stage === "CUMPRIMENTO" ? sentence.cumprimento_status : sentence.qualidade_status;
    const responsibleValue = options.stage === "CUMPRIMENTO" ? sentence.responsavel_cumprimento : sentence.responsavel_qualidade;

    if (statusMode === "ALL") {
      if (!statusValue || statusValue === "ENTREGUE") return false;
    } else if (statusValue !== statusMode) {
      return false;
    }
    if (statusMode === "PENDENTE" && !queuePendenciaMatches(sentence, options.pendencia)) return false;

    if (!queueSlaBucketMatches(sentence, options.stage, options.slaBucket)) return false;

    if (responsibleFilter) return responsibleValue === responsibleFilter;

    return true;
  });
}

function queuePendenciaMatches(sentence: Partial<Pick<SentenceRecord, "pendencia">>, pendencia: QueuePendenciaFilter | undefined) {
  if (!pendencia) return true;
  return queuePendenciaForSentence(sentence) === pendencia;
}

function queuePendenciaForSentence(sentence: Partial<Pick<SentenceRecord, "pendencia">>): QueuePendenciaFilter | null {
  const pendencia = sentence.pendencia?.trim();
  if (!pendencia) return queueMissingPendenciaValue;
  return canonicalQueuePendencia(pendencia);
}

function canonicalQueuePendencia(value: string | null | undefined): QueuePendenciaFilter | null {
  const pendencia = canonicalizeEventPendencia(value);
  if (!pendencia) return null;
  return queuePendenciaFilterValues.includes(pendencia as QueuePendenciaFilter) ? (pendencia as QueuePendenciaFilter) : null;
}

function queueSlaBucketMatches(sentence: SentenceRecord, stage: WorkflowStage, slaBucket: QueueSlaBucket | undefined) {
  if (!slaBucket) return true;

  return queueSlaBucketForSentence(sentence, stage) === slaBucket;
}

function countQueueSlaBuckets(sentences: SentenceRecord[], stage: WorkflowStage): OperationalQueueSlaCounts {
  const counts = emptySlaCounts(stage);

  for (const sentence of sentences) {
    const bucket = queueSlaBucketForSentence(sentence, stage);
    if (bucket) counts[bucket] = (counts[bucket] ?? 0) + 1;
  }

  return counts;
}

function slaCountsFromRows(stage: WorkflowStage, rows: QueueSlaCountRow[]): OperationalQueueSlaCounts {
  const counts = emptySlaCounts(stage);
  const validBuckets = queueSlaBucketsForStage(stage);

  for (const row of rows) {
    const bucket = row.bucket as QueueSlaBucket;
    if (!validBuckets.includes(bucket)) continue;
    counts[bucket] = Number(row.item_count ?? 0);
  }

  return counts;
}

function queueSlaBucketForSentence(sentence: SentenceRecord, stage: WorkflowStage): QueueSlaBucket | null {
  const startValue = stage === "CUMPRIMENTO" ? sentence.tratado : sentence.data_ultimo_evento;
  if (!startValue) return null;

  const start = parseISO(startValue);
  if (!isValid(start)) return null;

  const days = differenceInCalendarDays(new Date(), start);
  if (days < 0) return null;

  if (stage === "QUALIDADE") {
    if (days <= 7) return "0_7";
    if (days <= 14) return "8_14";
    if (days <= 30) return "15_30";
    if (days <= 60) return "31_60";
    return "61_PLUS";
  }

  if (days >= 5) return "5_PLUS";
  return String(days) as QueueSlaBucket;
}

function emptySlaCounts(stage: WorkflowStage): OperationalQueueSlaCounts {
  return Object.fromEntries(queueSlaBucketsForStage(stage).map((bucket) => [bucket, 0])) as OperationalQueueSlaCounts;
}

function sortOperationalQueueRows(
  sentences: SentenceRecord[],
  stage: WorkflowStage,
  sort?: QueueSortKey,
  direction: QueueSortDirection = "asc",
) {
  return [...sentences].sort((a, b) => {
    if (sort) {
      const sortDelta = compareQueueSortValue(a, b, stage, sort, direction);
      if (sortDelta !== 0) return sortDelta;
      return a.id.localeCompare(b.id);
    }

    const aStatus = stage === "CUMPRIMENTO" ? a.cumprimento_status : a.qualidade_status;
    const bStatus = stage === "CUMPRIMENTO" ? b.cumprimento_status : b.qualidade_status;
    const statusDelta = queueStatusRank(aStatus) - queueStatusRank(bStatus);
    if (statusDelta !== 0) return statusDelta;

    const aDate = a.data_ultimo_evento ?? "9999-12-31";
    const bDate = b.data_ultimo_evento ?? "9999-12-31";
    const dateDelta = aDate.localeCompare(bDate);
    if (dateDelta !== 0) return dateDelta;

    return a.id.localeCompare(b.id);
  });
}

function compareQueueSortValue(
  a: SentenceRecord,
  b: SentenceRecord,
  stage: WorkflowStage,
  sort: QueueSortKey,
  direction: QueueSortDirection,
) {
  const factor = direction === "desc" ? -1 : 1;

  if (sort === "status") {
    const aStatus = stage === "CUMPRIMENTO" ? a.cumprimento_status : a.qualidade_status;
    const bStatus = stage === "CUMPRIMENTO" ? b.cumprimento_status : b.qualidade_status;
    return (queueStatusRank(aStatus) - queueStatusRank(bStatus)) * factor;
  }

  if (sort === "order_summary") {
    return (localOrderCount(a.processo) - localOrderCount(b.processo)) * factor;
  }

  if (sort === "sla") {
    const aDate = stage === "CUMPRIMENTO" ? a.tratado : a.data_ultimo_evento;
    const bDate = stage === "CUMPRIMENTO" ? b.tratado : b.data_ultimo_evento;
    return compareNullableStrings(aDate, bDate, direction === "asc" ? "desc" : "asc");
  }

  const [aValue, bValue] = queueSortValues(a, b, stage, sort);
  return compareNullableStrings(aValue, bValue, direction);
}

function queueSortValues(a: SentenceRecord, b: SentenceRecord, stage: WorkflowStage, sort: QueueSortKey): [string | null | undefined, string | null | undefined] {
  switch (sort) {
    case "responsible":
      return stage === "CUMPRIMENTO"
        ? [a.responsavel_cumprimento, b.responsavel_cumprimento]
        : [a.responsavel_qualidade, b.responsavel_qualidade];
    case "processo":
      return [a.processo, b.processo];
    case "envio_bcc":
      return [a.envio_bcc, b.envio_bcc];
    case "stage_date":
      return stage === "CUMPRIMENTO" ? [a.envio_bcc, b.envio_bcc] : [a.cumprimento_data, b.cumprimento_data];
    case "data_ultimo_evento":
      return [a.data_ultimo_evento, b.data_ultimo_evento];
    case "origem":
      return [a.origem_normalized, b.origem_normalized];
    default:
      return [a.data_ultimo_evento, b.data_ultimo_evento];
  }
}

function compareNullableStrings(a: string | null | undefined, b: string | null | undefined, direction: QueueSortDirection) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const delta = a.localeCompare(b);
  return direction === "desc" ? -delta : delta;
}

function localOrderCount(processo: string) {
  const keys = new Set(
    sampleSalesforceOrders
      .filter((order) => order.is_latest && order.processo === processo)
      .map((order) => salesforceOrderGroupKey(order)),
  );
  return keys.size;
}

function sanitizeSearchTerm(query: string | undefined) {
  return query?.replace(/[%(),]/g, " ").trim();
}

function normalizeDashboardMetrics(value: unknown): DashboardBaseMetrics | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as DashboardMetricsPayload;

  return {
    cumprimentoStatus: normalizeDashboardStatus(payload.cumprimentoStatus),
    qualidadeStatus: normalizeDashboardStatus(payload.qualidadeStatus),
    points: normalizeDashboardPoints(payload.points),
    people: normalizeDashboardPeople(payload.people),
    total: toNumber(payload.total),
    overdue: toNumber(payload.overdue),
  };
}

function normalizeDashboardStatus(value: unknown): DashboardStatus {
  const status = emptyDashboardStatusCounts();
  if (!value || typeof value !== "object") return status;
  const counts = value as Record<string, unknown>;

  for (const label of dashboardStatusLabels) {
    status[label] = toNumber(counts[label]);
  }

  return status;
}

function normalizeDashboardPoints(value: unknown): DashboardBaseMetrics["points"] {
  if (!Array.isArray(value)) return [];

  return value.map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      date: typeof row.date === "string" ? row.date : "",
      recebido: toNumber(row.recebido),
      cumprimento: toNumber(row.cumprimento),
      qualidade: toNumber(row.qualidade),
      pendente: toNumber(row.pendente),
    };
  }).filter((point) => point.date);
}

function normalizeDashboardPeople(value: unknown): DashboardBaseMetrics["people"] {
  if (!Array.isArray(value)) return [];

  return value.map((item) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      name: typeof row.name === "string" ? row.name : "",
      cumprimento: toNumber(row.cumprimento),
      qualidade: toNumber(row.qualidade),
      pendente: toNumber(row.pendente),
    };
  }).filter((person) => person.name);
}

function toNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function addDashboardProduction(
  metrics: DashboardBaseMetrics,
  profile: Profile,
  responsibleName: string,
  events: DashboardEventRow[],
  today: Date,
): DashboardMetrics {
  return {
    ...metrics,
    currentUser: {
      name: responsibleName,
      role: profile.role,
    },
    production: buildDashboardProduction(events, responsibleName, today, canSeeFullProduction(profile)),
  };
}

function addDashboardProductionFromRows(
  metrics: DashboardBaseMetrics,
  profile: Profile,
  responsibleName: string,
  rows: DashboardProductionAggregateRow[],
): DashboardMetrics {
  return {
    ...metrics,
    currentUser: {
      name: responsibleName,
      role: profile.role,
    },
    production: buildDashboardProductionFromAggregates(rows, responsibleName, canSeeFullProduction(profile)),
  };
}

type ProductionPerson = {
  key: string;
  name: string;
  counts: ProductionCountsByKind;
  occurrenceDays: Record<ProductionKind, number>;
  isCurrentUser: boolean;
};

type ProductionMeasure = "total" | "delivered" | "pending";
type ProductionMetricCounts = Record<ProductionMeasure, number>;
type ProductionPeriodCounts = Record<ProductionPeriod, ProductionMetricCounts>;
type ProductionCountsByKind = Record<ProductionKind, ProductionPeriodCounts>;
type ProductionDaySets = Record<ProductionKind, Set<string>>;

function buildDashboardProduction(
  events: DashboardEventRow[],
  currentUserName: string,
  today: Date,
  showFullOperation: boolean,
): DashboardProduction {
  const todayKey = format(today, "yyyy-MM-dd");
  const currentUserKey = normalizeResponsibleKey(currentUserName);
  const people = new Map<string, ProductionPerson>();
  const operationCounts = emptyProductionCountsByKind();
  const operationOccurrenceDaySets = emptyProductionDaySets();
  const personOccurrenceDaySets = new Map<string, ProductionDaySets>();

  people.set(currentUserKey, {
    key: currentUserKey,
    name: currentUserName,
    counts: emptyProductionCountsByKind(),
    occurrenceDays: emptyProductionCounts(),
    isCurrentUser: true,
  });
  personOccurrenceDaySets.set(currentUserKey, emptyProductionDaySets());

  for (const event of events) {
    if (event.etapa !== "CUMPRIMENTO" && event.etapa !== "QUALIDADE") continue;

    const responsible = (event.performed_by ?? event.responsavel)?.trim();
    const responsibleKey = normalizeResponsibleKey(responsible);
    if (!responsible || !responsibleKey) continue;

    const row = people.get(responsibleKey) ?? {
      key: responsibleKey,
      name: responsible,
      counts: emptyProductionCountsByKind(),
      occurrenceDays: emptyProductionCounts(),
      isCurrentUser: responsibleKey === currentUserKey,
    };
    const kind: ProductionKind = event.etapa === "CUMPRIMENTO" ? "cumprimento" : "qualidade";
    const measure: ProductionMeasure = event.tipo_evento === "ENTREGUE" ? "delivered" : "pending";
    const occurrenceDaySets = personOccurrenceDaySets.get(responsibleKey) ?? emptyProductionDaySets();

    addProductionCount(row.counts, kind, "month", "total", 1);
    addProductionCount(row.counts, kind, "month", measure, 1);
    addProductionCount(operationCounts, kind, "month", "total", 1);
    addProductionCount(operationCounts, kind, "month", measure, 1);
    operationOccurrenceDaySets[kind].add(event.data_evento);
    occurrenceDaySets[kind].add(event.data_evento);
    if (event.data_evento === todayKey) {
      addProductionCount(row.counts, kind, "day", "total", 1);
      addProductionCount(row.counts, kind, "day", measure, 1);
      addProductionCount(operationCounts, kind, "day", "total", 1);
      addProductionCount(operationCounts, kind, "day", measure, 1);
    }

    if (responsibleKey === currentUserKey && event.data_evento === todayKey) {
      row.name = currentUserName;
      row.isCurrentUser = true;
    }

    people.set(responsibleKey, row);
    personOccurrenceDaySets.set(responsibleKey, occurrenceDaySets);
  }

  const currentUser = people.get(currentUserKey)!;
  currentUser.occurrenceDays = countProductionDaySets(personOccurrenceDaySets.get(currentUserKey) ?? emptyProductionDaySets());

  return {
    today: showFullOperation
      ? productionTotalCountsForPeriod(operationCounts, "day")
      : productionTotalCountsForPeriod(currentUser.counts, "day"),
    month: showFullOperation
      ? productionTotalCountsForPeriod(operationCounts, "month")
      : productionTotalCountsForPeriod(currentUser.counts, "month"),
    occurrenceDays: showFullOperation ? countProductionDaySets(operationOccurrenceDaySets) : { ...currentUser.occurrenceDays },
    ranking: buildProductionRanking([...people.values()], showFullOperation),
  };
}

function buildDashboardProductionFromAggregates(
  rows: DashboardProductionAggregateRow[],
  currentUserName: string,
  showFullOperation: boolean,
): DashboardProduction {
  const currentUserKey = normalizeResponsibleKey(currentUserName);
  const people = new Map<string, ProductionPerson>();
  const operationCounts = emptyProductionCountsByKind();
  const operationOccurrenceDays = emptyProductionCounts();

  for (const row of rows) {
    if (row.etapa !== "CUMPRIMENTO" && row.etapa !== "QUALIDADE") continue;

    const key = row.person_key || normalizeResponsibleKey(row.name);
    if (!key) continue;

    const isCurrentUser = Boolean(row.is_current_user) || normalizeResponsibleKey(row.name) === currentUserKey;
    const displayName = isCurrentUser ? currentUserName : row.name?.trim() || "Operador";
    const person = people.get(key) ?? {
      key,
      name: displayName,
      counts: emptyProductionCountsByKind(),
      occurrenceDays: emptyProductionCounts(),
      isCurrentUser,
    };
    const kind: ProductionKind = row.etapa === "CUMPRIMENTO" ? "cumprimento" : "qualidade";
    const dayTotalCount = toNumber(row.day_count ?? row.today_count);
    const dayDeliveredCount = toNumber(row.day_delivered_count);
    const dayPendingCount = toNumber(row.day_pending_count);
    const monthCount = toNumber(row.month_count);
    const monthDeliveredCount = toNumber(row.month_delivered_count);
    const monthPendingCount = toNumber(row.month_pending_count);
    const monthOccurrenceDays = toNumber(row.month_occurrence_days);
    const operationMonthOccurrenceDays = toNumber(row.operation_month_occurrence_days);

    addProductionBucketCounts(person.counts, kind, "day", {
      total: dayTotalCount,
      delivered: dayDeliveredCount,
      pending: dayPendingCount,
    });
    addProductionBucketCounts(person.counts, kind, "month", {
      total: monthCount,
      delivered: monthDeliveredCount,
      pending: monthPendingCount,
    });
    person.occurrenceDays[kind] += monthOccurrenceDays;
    addProductionBucketCounts(operationCounts, kind, "day", {
      total: dayTotalCount,
      delivered: dayDeliveredCount,
      pending: dayPendingCount,
    });
    addProductionBucketCounts(operationCounts, kind, "month", {
      total: monthCount,
      delivered: monthDeliveredCount,
      pending: monthPendingCount,
    });
    operationOccurrenceDays[kind] = Math.max(operationOccurrenceDays[kind], operationMonthOccurrenceDays);

    if (isCurrentUser) {
      person.name = currentUserName;
      person.isCurrentUser = true;
    }

    people.set(key, person);
  }

  let currentUser = [...people.values()].find((person) => person.isCurrentUser);
  if (!currentUser) {
    currentUser = {
      key: currentUserKey,
      name: currentUserName,
      counts: emptyProductionCountsByKind(),
      occurrenceDays: emptyProductionCounts(),
      isCurrentUser: true,
    };
    people.set(currentUserKey, currentUser);
  }

  return {
    today: showFullOperation
      ? productionTotalCountsForPeriod(operationCounts, "day")
      : productionTotalCountsForPeriod(currentUser.counts, "day"),
    month: showFullOperation
      ? productionTotalCountsForPeriod(operationCounts, "month")
      : productionTotalCountsForPeriod(currentUser.counts, "month"),
    occurrenceDays: showFullOperation ? { ...operationOccurrenceDays } : { ...currentUser.occurrenceDays },
    ranking: buildProductionRanking([...people.values()], showFullOperation),
  };
}

function buildProductionRanking(
  people: ProductionPerson[],
  showFullOperation: boolean,
): DashboardProduction["ranking"] {
  return {
    cumprimento: {
      month: buildProductionRankingRows(people, "cumprimento", "month", showFullOperation),
      day: buildProductionRankingRows(people, "cumprimento", "day", showFullOperation),
    },
    qualidade: {
      month: buildProductionRankingRows(people, "qualidade", "month", showFullOperation),
      day: buildProductionRankingRows(people, "qualidade", "day", showFullOperation),
    },
  };
}

function buildProductionRankingRows(
  people: ProductionPerson[],
  kind: ProductionKind,
  period: ProductionPeriod,
  showFullOperation: boolean,
): DashboardProduction["ranking"][ProductionKind][ProductionPeriod] {
  const ranked = people
    .map((person) => {
      const counts = person.counts[kind][period];
      return { person, counts, value: counts.total };
    })
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value || a.person.name.localeCompare(b.person.name) || a.person.key.localeCompare(b.person.key))
    .map(({ person, counts, value }, index) => ({
      name: showFullOperation || person.isCurrentUser ? person.name : `Operador ${index + 1}`,
      position: index + 1,
      value,
      total: counts.total,
      delivered: counts.delivered,
      pending: counts.pending,
      isCurrentUser: person.isCurrentUser,
    }));

  if (showFullOperation) return ranked;

  const currentUserIndex = ranked.findIndex((row) => row.isCurrentUser);
  if (currentUserIndex === -1 || currentUserIndex < 8) return ranked.slice(0, 8);

  return [...ranked.slice(0, 7), ranked[currentUserIndex]];
}

function emptyProductionCounts(): Record<ProductionKind, number> {
  return { cumprimento: 0, qualidade: 0 };
}

function emptyProductionMetricCounts(): ProductionMetricCounts {
  return { total: 0, delivered: 0, pending: 0 };
}

function emptyProductionPeriodCounts(): ProductionPeriodCounts {
  return {
    month: emptyProductionMetricCounts(),
    day: emptyProductionMetricCounts(),
  };
}

function emptyProductionCountsByKind(): ProductionCountsByKind {
  return {
    cumprimento: emptyProductionPeriodCounts(),
    qualidade: emptyProductionPeriodCounts(),
  };
}

function addProductionCount(
  counts: ProductionCountsByKind,
  kind: ProductionKind,
  period: ProductionPeriod,
  measure: ProductionMeasure,
  value: number,
) {
  counts[kind][period][measure] += value;
}

function addProductionBucketCounts(
  counts: ProductionCountsByKind,
  kind: ProductionKind,
  period: ProductionPeriod,
  values: ProductionMetricCounts,
) {
  counts[kind][period].total += values.total;
  counts[kind][period].delivered += values.delivered;
  counts[kind][period].pending += values.pending;
}

function productionTotalCountsForPeriod(
  counts: ProductionCountsByKind,
  period: ProductionPeriod,
): Record<ProductionKind, number> {
  return {
    cumprimento: counts.cumprimento[period].total,
    qualidade: counts.qualidade[period].total,
  };
}

function emptyProductionDaySets(): ProductionDaySets {
  return { cumprimento: new Set(), qualidade: new Set() };
}

function countProductionDaySets(daySets: ProductionDaySets): Record<ProductionKind, number> {
  return { cumprimento: daySets.cumprimento.size, qualidade: daySets.qualidade.size };
}

function normalizeResponsibleKey(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

function canSeeFullProduction(profile: Pick<Profile, "active" | "role">) {
  return canViewAllOperationalData(profile);
}

function buildDashboard(sentences: SentenceRecord[], events: DashboardEventRow[], start: Date, end: Date): DashboardBaseMetrics {
  const statusTemplate = emptyDashboardStatusCounts();
  const cumprimentoStatus = { ...statusTemplate };
  const qualidadeStatus = { ...statusTemplate };
  const people = new Map<string, { name: string; cumprimento: number; qualidade: number; pendente: number }>();
  const dayMap = new Map(eachDayOfInterval({ start, end }).map((day) => [format(day, "yyyy-MM-dd"), { date: format(day, "yyyy-MM-dd"), recebido: 0, cumprimento: 0, qualidade: 0, pendente: 0 }]));

  for (const sentence of sentences) {
    countDashboardStatus(cumprimentoStatus, sentence.cumprimento_status);
    countDashboardStatus(qualidadeStatus, sentence.qualidade_status);
    if (sentence.envio_bcc && dayMap.has(sentence.envio_bcc)) dayMap.get(sentence.envio_bcc)!.recebido += 1;
  }

  for (const event of events) {
    const point = dayMap.get(event.data_evento);
    if (!point) continue;
    if (event.tipo_evento === "PENDENTE") point.pendente += 1;
    if (event.etapa === "CUMPRIMENTO") point.cumprimento += 1;
    if (event.etapa === "QUALIDADE") point.qualidade += 1;
    const performedBy = event.performed_by ?? event.responsavel;
    if (performedBy) {
      const row = people.get(performedBy) ?? { name: performedBy, cumprimento: 0, qualidade: 0, pendente: 0 };
      if (event.tipo_evento === "PENDENTE") row.pendente += 1;
      if (event.etapa === "CUMPRIMENTO") row.cumprimento += 1;
      if (event.etapa === "QUALIDADE") row.qualidade += 1;
      people.set(performedBy, row);
    }
  }

  return {
    cumprimentoStatus,
    qualidadeStatus,
    points: [...dayMap.values()],
    people: [...people.values()].sort((a, b) => b.cumprimento + b.qualidade - (a.cumprimento + a.qualidade)).slice(0, 12),
    total: sentences.filter(isActiveDashboardSentence).length,
    overdue: sentences.filter(isOverdue).length,
  };
}
