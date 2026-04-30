import { eachDayOfInterval, format, parseISO, startOfMonth } from "date-fns";
import { getAppRequestContext, type AppRequestContext, type SupabaseServerClient } from "@/lib/request-context";
import { QUEUE_PAGE_SIZE, queueOffset, queueStatusOrder, queueStatusRank, type QueueSortDirection, type QueueSortKey, type QueueViewMode } from "@/lib/queue";
import { buildSampleDashboard, sampleEvents, sampleProfile, sampleSalesforceOrders, sampleSentences } from "@/lib/sample-data";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isOverdue, statusLabels } from "@/lib/normalization";
import type { AssignableProfile, DashboardMetrics, DashboardProduction, DashboardStatus, EventResponsibleOption, ManagedUser, Profile, ProductionKind, QueueStatusMode, SalesforceOrderGroup, SalesforceOrderQueueSummary, SalesforceOrderRecord, SalesforceOrdersSummary, SentenceEvent, SentenceRecord, SentenceStatus, WorkflowStage } from "@/lib/types";

const sentenceListSelect = `
  id,
  processo,
  envio_bcc,
  origem_raw,
  origem_normalized,
  tratado,
  tipo_justica_raw,
  cpf_cnpj,
  responsavel_cumprimento,
  responsavel_qualidade,
  cumprimento_status,
  qualidade_status,
  cumprimento_data,
  qualidade_data,
  data_ultimo_evento
`;

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
  cumprimento_status,
  qualidade_status,
  cumprimento_data,
  qualidade_data,
  data_ultimo_evento,
  import_warnings
`;

const dashboardSelect = `
  id,
  envio_bcc,
  tratado,
  prazo_fatal,
  responsavel_cumprimento,
  responsavel_qualidade,
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

const dashboardPageSize = 1000;
const dashboardStatusLabels = statusLabels.filter((status): status is Exclude<SentenceStatus, "ENTREGUE"> => status !== "ENTREGUE");

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
  month_count: number | string | null;
};

type FilterOptions = {
  status: Array<[string, number]>;
  responsible: Array<[string, number]>;
  isManager: boolean;
  lockedResponsible: string | null;
};

type FilterCountRow = {
  kind: string | null;
  value: string | null;
  item_count: number | string | null;
};

type QueueSummaryRow = {
  stage: WorkflowStage | string | null;
  kind: string | null;
  value: string | null;
  item_count: number | string | null;
};

type QueueItemRow = SentenceRecord & {
  next_cursor?: string | null;
  total_count?: number | string | null;
  order_total?: number | string | null;
  order_open?: number | string | null;
  order_closed?: number | string | null;
  order_unknown?: number | string | null;
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
};

type DashboardBaseMetrics = Omit<DashboardMetrics, "currentUser" | "production">;

type OperationalQueueSummaryOptions = {
  responsible?: string;
  query?: string;
  view?: QueueViewMode;
};

export type OperationalQueueSummary = {
  statusCounts: Record<SentenceStatus, number>;
  responsible: Array<[string, number]>;
  total: number;
  isManager: boolean;
  lockedResponsible: string | null;
};

export type OperationalQueueResult = {
  sentences: SentenceRecord[];
  nextCursor: string | null;
  pageSize: number;
  offset: number;
  total: number;
  orderSummariesByProcess: Record<string, SalesforceOrderQueueSummary>;
};

export async function getCurrentProfile(): Promise<Profile> {
  const context = await getAppRequestContext();
  return context.profile;
}

export function canManageUsers(profile: Pick<Profile, "active" | "role">) {
  return profile.active && (profile.role === "admin" || profile.role === "gestor");
}

export async function getManagedUsers(): Promise<ManagedUser[]> {
  const context = await getAppRequestContext();
  if (!canManageUsers(context.profile)) return [];
  if (!context.supabase) return [{ ...sampleProfile, created_at: null }];

  const { data, error } = await context.supabase
    .from("profiles")
    .select("id,email,full_name,role,active,created_at")
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

  const { data, error } = await context.supabase
    .from("profiles")
    .select("id,email,full_name,role")
    .eq("active", true)
    .order("full_name", { ascending: true, nullsFirst: false })
    .order("email", { ascending: true });

  if (error) throwSupabaseError("getAssignableProfiles", error);

  return ((data ?? []) as Profile[])
    .map((profile) => ({
      id: profile.id,
      displayName: profile.full_name?.trim() || profile.email,
      email: profile.email,
      role: profile.role,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.email.localeCompare(b.email));
}

export async function getEventResponsibleOptions(): Promise<EventResponsibleOption[]> {
  const context = await getAppRequestContext();
  if (!context.supabase) return [toEventResponsibleOption(sampleProfile)];

  const admin = createSupabaseAdminClient();
  const client = admin ?? context.supabase;
  const { data, error } = await client
    .from("profiles")
    .select("id,email,full_name")
    .eq("active", true)
    .order("full_name", { ascending: true, nullsFirst: false })
    .order("email", { ascending: true });

  if (error) throwSupabaseError("getEventResponsibleOptions", error);

  return ((data ?? []) as Pick<Profile, "id" | "email" | "full_name">[])
    .map(toEventResponsibleOption)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function getSentences(options: {
  stage?: WorkflowStage;
  query?: string;
  status?: string;
  responsible?: string;
  limit?: number;
} = {}): Promise<SentenceRecord[]> {
  const { stage, query, status, responsible, limit = 200 } = options;
  const context = await getAppRequestContext();
  if (!context.supabase) return filterLocalSentences(sampleSentences, options).slice(0, limit);

  let request = context.supabase
    .from("sentences")
    .select(sentenceListSelect)
    .order("data_ultimo_evento", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (stage === "CUMPRIMENTO") {
    if (status && status !== "ALL") request = request.eq("cumprimento_status", status);
    request = applyResponsibleScope(request, context, "responsavel_cumprimento", responsible);
  }

  if (stage === "QUALIDADE") {
    if (status && status !== "ALL") request = request.eq("qualidade_status", status);
    request = applyResponsibleScope(request, context, "responsavel_qualidade", responsible);
  }

  if (query) {
    const term = sanitizeSearchTerm(query);
    if (term) request = request.or(`processo.ilike.%${term}%,autor.ilike.%${term}%,cpf_cnpj.ilike.%${term}%,uc.ilike.%${term}%`);
  }

  const { data, error } = await request;
  if (error) throwSupabaseError("getSentences", error);
  return (data ?? []) as SentenceRecord[];
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
  if (error) throwSupabaseError("getSentence", error);
  return data as SentenceRecord | null;
}

export async function getSentenceEvents(sentenceId: string): Promise<SentenceEvent[]> {
  const context = await getAppRequestContext();
  if (!context.supabase) return sampleEvents.filter((event) => event.sentence_id === sentenceId);

  const { data, error } = await context.supabase
    .from("sentence_events")
    .select("*")
    .eq("sentence_id", sentenceId)
    .order("data_evento", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throwSupabaseError("getSentenceEvents", error);
  return (data ?? []) as SentenceEvent[];
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

export async function getDashboardMetrics(from?: string, to?: string): Promise<DashboardMetrics> {
  const context = await getAppRequestContext();
  if (!context.supabase) return buildSampleDashboard(context.profile);

  const today = new Date();
  const monthStart = startOfMonth(today);
  const start = from ? parseISO(from) : startOfMonth(today);
  const end = to ? parseISO(to) : today;
  const productionClient = (createSupabaseAdminClient() ?? context.supabase) as SupabaseServerClient;

  const { data, error } = await context.supabase.rpc("dashboard_metrics", {
    from_arg: format(start, "yyyy-MM-dd"),
    to_arg: format(end, "yyyy-MM-dd"),
  });
  const metrics = !error ? normalizeDashboardMetrics(data) : null;
  if (metrics) {
    const productionRows = await getDashboardProductionRows(context.supabase, today);
    if (productionRows) {
      return addDashboardProductionFromRows(metrics, context.profile, context.responsibleName, productionRows);
    }

    const productionEvents = await getDashboardEvents(productionClient, monthStart, today);
    return addDashboardProduction(metrics, context.profile, context.responsibleName, productionEvents, today);
  }

  const [sentences, events, productionRows] = await Promise.all([
    getDashboardSentences(context.supabase),
    getDashboardEvents(context.supabase, start, end),
    getDashboardProductionRows(context.supabase, today),
  ]);

  const dashboard = buildDashboard(sentences, events, start, end);
  if (productionRows) {
    return addDashboardProductionFromRows(dashboard, context.profile, context.responsibleName, productionRows);
  }

  const productionEvents = await getDashboardEvents(productionClient, monthStart, today);
  return addDashboardProduction(dashboard, context.profile, context.responsibleName, productionEvents, today);
}

export async function getFilterOptions(stage: WorkflowStage): Promise<FilterOptions> {
  const context = await getAppRequestContext();
  const lockedResponsible = context.isManager ? null : context.responsibleName;

  if (!context.supabase) {
    return summarizeFilterRows(filterLocalSentences(sampleSentences, { stage }), stage, context.isManager, lockedResponsible);
  }

  const { data, error } = await context.supabase.rpc("sentence_stage_filter_counts", { stage_arg: stage });
  if (!error && data) {
    return summarizeFilterCountRows(data as FilterCountRow[], context.isManager, lockedResponsible);
  }

  const select = stage === "CUMPRIMENTO" ? "cumprimento_status,responsavel_cumprimento" : "qualidade_status,responsavel_qualidade";
  const rows = await getRemoteFilterRows(context.supabase, context, stage, select);
  return summarizeFilterRows(rows, stage, context.isManager, lockedResponsible);
}

export async function getOperationalQueueSummary(stage: WorkflowStage, options: OperationalQueueSummaryOptions = {}): Promise<OperationalQueueSummary> {
  const context = await getAppRequestContext();
  const lockedResponsible = context.isManager ? null : context.responsibleName;
  const responsible = options.responsible?.trim() || undefined;
  const query = options.query?.trim() || undefined;
  const view = options.view ?? "operational";

  if (view === "dashboard-status") {
    if (!context.supabase) {
      const rows = filterDashboardStatusQueueRows(sampleSentences, { stage, statusMode: "ALL", query }, context);
      return summarizeOperationalQueueRows(
        rows,
        stage,
        context.isManager,
        lockedResponsible,
        responsible,
      );
    }

    return getRemoteDashboardStatusQueueSummary(context, stage, responsible, query, lockedResponsible);
  }

  if (!context.supabase) {
    const rows = filterOperationalQueueRows(sampleSentences, { stage, statusMode: "ALL", query }, context);
    return summarizeOperationalQueueRows(
      rows,
      stage,
      context.isManager,
      lockedResponsible,
      responsible,
    );
  }

  const { data, error } = await context.supabase.rpc("operational_queue_summary", {
    stage_arg: stage,
    responsible_arg: responsible ?? null,
    q_arg: query ?? null,
  });
  if (!error && data) {
    return summarizeOperationalQueueCounts(data as QueueSummaryRow[], stage, context.isManager, lockedResponsible);
  }

  const legacy = await context.supabase.rpc("operational_queue_summary");
  if (!legacy.error && legacy.data) {
    return summarizeOperationalQueueCounts(legacy.data as QueueSummaryRow[], stage, context.isManager, lockedResponsible);
  }

  const rows = await getRemoteOperationalQueueSummaryRows(context, stage, query);
  return summarizeOperationalQueueRows(rows, stage, context.isManager, lockedResponsible, responsible);
}

export async function getOperationalQueueItems(options: {
  stage: WorkflowStage;
  statusMode: QueueStatusMode;
  responsible?: string;
  query?: string;
  cursor?: string;
  pageSize?: number;
  sort?: QueueSortKey;
  sortDirection?: QueueSortDirection;
  view?: QueueViewMode;
}): Promise<OperationalQueueResult> {
  const context = await getAppRequestContext();
  const pageSize = clampPageSize(options.pageSize);
  const offset = queueOffset(options.cursor);
  const fetchSize = pageSize + 1;
  const view = options.view ?? "operational";

  if (view === "dashboard-status") {
    if (!context.supabase) {
      const filtered = sortOperationalQueueRows(filterDashboardStatusQueueRows(sampleSentences, options, context), options.stage, options.sort, options.sortDirection);
      const rows = filtered.slice(offset, offset + fetchSize);
      return pageOperationalQueueRows(rows, pageSize, offset, filtered.length);
    }

    const dashboardRows = await getRemoteDashboardStatusQueueRows(context, options, fetchSize, offset);
    return pageOperationalQueueRows(dashboardRows.rows, pageSize, offset, dashboardRows.total);
  }

  if (!context.supabase) {
    const filtered = sortOperationalQueueRows(filterOperationalQueueRows(sampleSentences, options, context), options.stage, options.sort, options.sortDirection);
    const rows = filtered.slice(offset, offset + fetchSize);
    return pageOperationalQueueRows(rows, pageSize, offset, filtered.length);
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

function applyResponsibleScope<T extends { eq: (column: string, value: string) => T }>(
  request: T,
  context: AppRequestContext,
  column: "responsavel_cumprimento" | "responsavel_qualidade",
  responsible?: string,
) {
  if (!context.isManager) return request.eq(column, context.responsibleName);
  if (responsible && responsible !== "ALL") return request.eq(column, responsible);
  return request;
}

async function getRemoteFilterRows(
  supabase: SupabaseServerClient,
  context: AppRequestContext,
  stage: WorkflowStage,
  select: string,
) {
  let request = supabase.from("sentences").select(select).limit(5000);
  if (stage === "CUMPRIMENTO") {
    request = applyResponsibleScope(request, context, "responsavel_cumprimento");
  }
  if (stage === "QUALIDADE") {
    request = applyResponsibleScope(request, context, "responsavel_qualidade");
  }

  const { data, error } = await request;
  if (error) throwSupabaseError(`getFilterOptions.${stage}`, error);
  return (data ?? []) as Partial<SentenceRecord>[];
}

function summarizeFilterCountRows(rows: FilterCountRow[], isManager: boolean, lockedResponsible: string | null): FilterOptions {
  const status = new Map<string, number>();
  const responsible = new Map<string, number>();

  for (const row of rows) {
    if (!row.value) continue;
    const count = Number(row.item_count ?? 0);
    if (row.kind === "status") status.set(row.value, count);
    if (row.kind === "responsible") responsible.set(row.value, count);
  }

  return {
    status: [...status.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    responsible: [...responsible.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    isManager,
    lockedResponsible,
  };
}

function summarizeFilterRows(
  sentences: Partial<SentenceRecord>[],
  stage: WorkflowStage,
  isManager: boolean,
  lockedResponsible: string | null,
): FilterOptions {
  const status = new Map<string, number>();
  const responsible = new Map<string, number>();

  for (const sentence of sentences) {
    const statusValue = stage === "CUMPRIMENTO" ? sentence.cumprimento_status : sentence.qualidade_status;
    const responsibleValue = stage === "CUMPRIMENTO" ? sentence.responsavel_cumprimento : sentence.responsavel_qualidade;
    if (statusValue) status.set(statusValue, (status.get(statusValue) ?? 0) + 1);
    if (responsibleValue) responsible.set(responsibleValue, (responsible.get(responsibleValue) ?? 0) + 1);
  }

  return {
    status: [...status.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    responsible: [...responsible.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    isManager,
    lockedResponsible,
  };
}

function summarizeOperationalQueueCounts(
  rows: QueueSummaryRow[],
  stage: WorkflowStage,
  isManager: boolean,
  lockedResponsible: string | null,
): OperationalQueueSummary {
  const statusCounts = emptyStatusCounts();
  const responsible = new Map<string, number>();

  for (const row of rows) {
    if (row.stage !== stage || !row.value) continue;
    const count = Number(row.item_count ?? 0);
    if (row.kind === "status" && isSentenceStatus(row.value)) statusCounts[row.value] = count;
    if (row.kind === "responsible") responsible.set(row.value, count);
  }

  return buildOperationalQueueSummary(statusCounts, responsible, isManager, lockedResponsible);
}

function summarizeOperationalQueueRows(
  sentences: Partial<SentenceRecord>[],
  stage: WorkflowStage,
  isManager: boolean,
  lockedResponsible: string | null,
  responsibleFilter?: string,
): OperationalQueueSummary {
  const statusCounts = emptyStatusCounts();
  const responsible = new Map<string, number>();
  const normalizedResponsibleFilter = isManager && responsibleFilter && responsibleFilter !== "ALL" ? responsibleFilter : null;

  for (const sentence of sentences) {
    const statusValue = stage === "CUMPRIMENTO" ? sentence.cumprimento_status : sentence.qualidade_status;
    const responsibleValue = stage === "CUMPRIMENTO" ? sentence.responsavel_cumprimento : sentence.responsavel_qualidade;
    const includeInStatusCount = !normalizedResponsibleFilter || responsibleValue === normalizedResponsibleFilter;
    if (statusValue && includeInStatusCount) statusCounts[statusValue] += 1;
    if (responsibleValue) responsible.set(responsibleValue, (responsible.get(responsibleValue) ?? 0) + 1);
  }

  return buildOperationalQueueSummary(statusCounts, responsible, isManager, lockedResponsible);
}

function buildOperationalQueueSummary(
  statusCounts: Record<SentenceStatus, number>,
  responsible: Map<string, number>,
  isManager: boolean,
  lockedResponsible: string | null,
): OperationalQueueSummary {
  return {
    statusCounts,
    responsible: [...responsible.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    total: statusLabels.reduce((sum, status) => sum + statusCounts[status], 0),
    isManager,
    lockedResponsible,
  };
}

function emptyStatusCounts(): Record<SentenceStatus, number> {
  return Object.fromEntries(statusLabels.map((status) => [status, 0])) as Record<SentenceStatus, number>;
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
  return data as DashboardProductionAggregateRow[];
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

async function getRemoteOperationalQueueSummaryRows(context: AppRequestContext, stage: WorkflowStage, query?: string) {
  const select = stage === "CUMPRIMENTO" ? "cumprimento_status,responsavel_cumprimento" : "qualidade_status,responsavel_qualidade";
  const request = buildRemoteQueueRequest(context, stage, "ALL", undefined, query, select).limit(10000);
  const { data, error } = await request;
  if (error) throwSupabaseError(`getOperationalQueueSummary.${stage}`, error);
  return (data ?? []) as Partial<SentenceRecord>[];
}

async function getRemoteDashboardStatusQueueSummary(
  context: AppRequestContext,
  stage: WorkflowStage,
  responsible: string | undefined,
  query: string | undefined,
  lockedResponsible: string | null,
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
    undefined,
    query,
    responsibleColumn,
  ).limit(10000);
  if (error) throwSupabaseError(`getDashboardStatusQueueSummary.responsible.${stage}`, error);

  const responsibleCounts = new Map<string, number>();
  for (const row of (data ?? []) as Partial<SentenceRecord>[]) {
    const responsibleValue = stage === "CUMPRIMENTO" ? row.responsavel_cumprimento : row.responsavel_qualidade;
    if (responsibleValue) responsibleCounts.set(responsibleValue, (responsibleCounts.get(responsibleValue) ?? 0) + 1);
  }

  return buildOperationalQueueSummary(statusCounts, responsibleCounts, context.isManager, lockedResponsible);
}

async function getRemoteOperationalQueueRows(
  context: AppRequestContext,
  options: {
    stage: WorkflowStage;
    statusMode: QueueStatusMode;
    responsible?: string;
    query?: string;
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
    const countRequest = buildRemoteQueueRequest(context, options.stage, status, options.responsible, options.query, "id", { count: "exact", head: true });
    const { count, error: countError } = await countRequest;
    if (countError) throwSupabaseError(`getOperationalQueueItems.count.${options.stage}`, countError);

    const statusCount = count ?? 0;
    total += statusCount;
    if (skipped >= statusCount) {
      skipped -= statusCount;
      continue;
    }

    const needed = fetchSize - rows.length;
    const request = applyQueuePostgrestOrder(
      buildRemoteQueueRequest(context, options.stage, status, options.responsible, options.query, sentenceListSelect),
      options.stage,
      options.sort,
      options.sortDirection,
    ).range(skipped, skipped + needed - 1);

    const { data, error } = await request;

    if (error) throwSupabaseError(`getOperationalQueueItems.${options.stage}`, error);
    rows.push(...((data ?? []) as unknown as SentenceRecord[]));
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
    responsible?: string;
    query?: string;
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
    const countRequest = buildDashboardStatusQueueRequest(context, options.stage, status, options.responsible, options.query, "id", { count: "exact", head: true });
    const { count, error: countError } = await countRequest;
    if (countError) throwSupabaseError(`getDashboardStatusQueueItems.count.${options.stage}`, countError);

    const statusCount = count ?? 0;
    total += statusCount;
    if (skipped >= statusCount) {
      skipped -= statusCount;
      continue;
    }

    const needed = fetchSize - rows.length;
    const request = applyQueuePostgrestOrder(
      buildDashboardStatusQueueRequest(context, options.stage, status, options.responsible, options.query, sentenceListSelect),
      options.stage,
      options.sort,
      options.sortDirection,
    ).range(skipped, skipped + needed - 1);

    const { data, error } = await request;

    if (error) throwSupabaseError(`getDashboardStatusQueueItems.${options.stage}`, error);
    rows.push(...((data ?? []) as unknown as SentenceRecord[]));
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

  return request;
}

function buildDashboardStatusQueueRequest(
  context: AppRequestContext,
  stage: WorkflowStage,
  statusMode: QueueStatusMode,
  responsible: string | undefined,
  query: string | undefined,
  select: string,
  options?: { count: "exact"; head: true },
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

  return request;
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
  const slaDateColumn = stage === "CUMPRIMENTO" ? "envio_bcc" : "data_ultimo_evento";

  switch (sort) {
    case "responsible":
      return request.order(responsibleColumn, { ascending, nullsFirst: false }).order("id", { ascending: true });
    case "processo":
      return request.order("processo", { ascending, nullsFirst: false }).order("id", { ascending: true });
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

function filterLocalSentences(sentences: SentenceRecord[], options: { stage?: WorkflowStage; query?: string; status?: string; responsible?: string }) {
  const query = options.query?.toUpperCase();
  return sentences.filter((sentence) => {
    if (query) {
      const haystack = [sentence.processo, sentence.autor, sentence.cpf_cnpj, sentence.uc].join(" ").toUpperCase();
      if (!haystack.includes(query)) return false;
    }
    if (options.stage === "CUMPRIMENTO") {
      if (options.status && options.status !== "ALL" && sentence.cumprimento_status !== options.status) return false;
      if (options.responsible && options.responsible !== "ALL" && sentence.responsavel_cumprimento !== options.responsible) return false;
    }
    if (options.stage === "QUALIDADE") {
      if (options.status && options.status !== "ALL" && sentence.qualidade_status !== options.status) return false;
      if (options.responsible && options.responsible !== "ALL" && sentence.responsavel_qualidade !== options.responsible) return false;
    }
    return true;
  });
}

function filterOperationalQueueRows(
  sentences: SentenceRecord[],
  options: { stage: WorkflowStage; statusMode?: QueueStatusMode; query?: string; responsible?: string },
  context: AppRequestContext,
) {
  const query = options.query?.toUpperCase();
  const statusMode = options.statusMode ?? "EM ANDAMENTO";

  return sentences.filter((sentence) => {
    if (query) {
      const haystack = [sentence.processo, sentence.autor, sentence.cpf_cnpj, sentence.uc].join(" ").toUpperCase();
      if (!haystack.includes(query)) return false;
    }

    if (options.stage === "QUALIDADE" && sentence.cumprimento_status !== "ENTREGUE") return false;

    const statusValue = options.stage === "CUMPRIMENTO" ? sentence.cumprimento_status : sentence.qualidade_status;
    const responsibleValue = options.stage === "CUMPRIMENTO" ? sentence.responsavel_cumprimento : sentence.responsavel_qualidade;

    if (statusMode !== "ALL" && statusValue !== statusMode) return false;

    if (!context.isManager) return responsibleValue === context.responsibleName;
    if (options.responsible && options.responsible !== "ALL") return responsibleValue === options.responsible;

    return true;
  });
}

function filterDashboardStatusQueueRows(
  sentences: SentenceRecord[],
  options: { stage: WorkflowStage; statusMode?: QueueStatusMode; query?: string; responsible?: string },
  context: AppRequestContext,
) {
  const query = options.query?.toUpperCase();
  const statusMode = options.statusMode ?? "EM ANDAMENTO";

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

    if (!context.isManager) return responsibleValue === context.responsibleName;
    if (options.responsible && options.responsible !== "ALL") return responsibleValue === options.responsible;

    return true;
  });
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
    const aDate = stage === "CUMPRIMENTO" ? a.envio_bcc : a.data_ultimo_evento;
    const bDate = stage === "CUMPRIMENTO" ? b.envio_bcc : b.data_ultimo_evento;
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
  cumprimento: number;
  qualidade: number;
  today: Record<ProductionKind, number>;
  isCurrentUser: boolean;
};

function buildDashboardProduction(
  events: DashboardEventRow[],
  currentUserName: string,
  today: Date,
  showFullOperation: boolean,
): DashboardProduction {
  const todayKey = format(today, "yyyy-MM-dd");
  const currentUserKey = normalizeResponsibleKey(currentUserName);
  const people = new Map<string, ProductionPerson>();
  const operationToday = emptyProductionCounts();
  const operationMonth = emptyProductionCounts();

  people.set(currentUserKey, {
    key: currentUserKey,
    name: currentUserName,
    cumprimento: 0,
    qualidade: 0,
    today: emptyProductionCounts(),
    isCurrentUser: true,
  });

  for (const event of events) {
    if (event.etapa !== "CUMPRIMENTO" && event.etapa !== "QUALIDADE") continue;

    const responsible = (event.performed_by ?? event.responsavel)?.trim();
    const responsibleKey = normalizeResponsibleKey(responsible);
    if (!responsible || !responsibleKey) continue;

    const row = people.get(responsibleKey) ?? {
      key: responsibleKey,
      name: responsible,
      cumprimento: 0,
      qualidade: 0,
      today: emptyProductionCounts(),
      isCurrentUser: responsibleKey === currentUserKey,
    };
    const kind: ProductionKind = event.etapa === "CUMPRIMENTO" ? "cumprimento" : "qualidade";

    row[kind] += 1;
    operationMonth[kind] += 1;
    if (event.data_evento === todayKey) operationToday[kind] += 1;

    if (responsibleKey === currentUserKey && event.data_evento === todayKey) {
      row.today[kind] += 1;
      row.name = currentUserName;
      row.isCurrentUser = true;
    }

    people.set(responsibleKey, row);
  }

  const currentUser = people.get(currentUserKey)!;

  return {
    today: showFullOperation ? { ...operationToday } : { ...currentUser.today },
    month: showFullOperation
      ? { ...operationMonth }
      : {
          cumprimento: currentUser.cumprimento,
          qualidade: currentUser.qualidade,
        },
    ranking: {
      cumprimento: buildProductionRankingRows([...people.values()], "cumprimento", showFullOperation),
      qualidade: buildProductionRankingRows([...people.values()], "qualidade", showFullOperation),
    },
  };
}

function buildDashboardProductionFromAggregates(
  rows: DashboardProductionAggregateRow[],
  currentUserName: string,
  showFullOperation: boolean,
): DashboardProduction {
  const currentUserKey = normalizeResponsibleKey(currentUserName);
  const people = new Map<string, ProductionPerson>();
  const operationToday = emptyProductionCounts();
  const operationMonth = emptyProductionCounts();

  for (const row of rows) {
    if (row.etapa !== "CUMPRIMENTO" && row.etapa !== "QUALIDADE") continue;

    const key = row.person_key || normalizeResponsibleKey(row.name);
    if (!key) continue;

    const isCurrentUser = Boolean(row.is_current_user) || normalizeResponsibleKey(row.name) === currentUserKey;
    const displayName = isCurrentUser ? currentUserName : row.name?.trim() || "Operador";
    const person = people.get(key) ?? {
      key,
      name: displayName,
      cumprimento: 0,
      qualidade: 0,
      today: emptyProductionCounts(),
      isCurrentUser,
    };
    const kind: ProductionKind = row.etapa === "CUMPRIMENTO" ? "cumprimento" : "qualidade";
    const todayCount = toNumber(row.today_count);
    const monthCount = toNumber(row.month_count);

    person[kind] += monthCount;
    person.today[kind] += todayCount;
    operationMonth[kind] += monthCount;
    operationToday[kind] += todayCount;

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
      cumprimento: 0,
      qualidade: 0,
      today: emptyProductionCounts(),
      isCurrentUser: true,
    };
    people.set(currentUserKey, currentUser);
  }

  return {
    today: showFullOperation ? { ...operationToday } : { ...currentUser.today },
    month: showFullOperation
      ? { ...operationMonth }
      : {
          cumprimento: currentUser.cumprimento,
          qualidade: currentUser.qualidade,
        },
    ranking: {
      cumprimento: buildProductionRankingRows([...people.values()], "cumprimento", showFullOperation),
      qualidade: buildProductionRankingRows([...people.values()], "qualidade", showFullOperation),
    },
  };
}

function buildProductionRankingRows(
  people: ProductionPerson[],
  kind: ProductionKind,
  showFullOperation: boolean,
): DashboardProduction["ranking"][ProductionKind] {
  const ranked = people
    .filter((person) => person[kind] > 0)
    .sort((a, b) => b[kind] - a[kind] || a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
    .map((person, index) => ({
      name: showFullOperation || person.isCurrentUser ? person.name : `Operador ${index + 1}`,
      position: index + 1,
      value: person[kind],
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

function normalizeResponsibleKey(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

function canSeeFullProduction(profile: Pick<Profile, "active" | "role">) {
  return profile.active && (profile.role === "admin" || profile.role === "gestor");
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
