import { canonicalizeEventPendencia, eventPendingOptions, type EventPendingOption } from "@/lib/event-taxonomy";
import type { QueueStatusMode, SentenceStatus, WorkflowStage } from "@/lib/types";

export const QUEUE_PAGE_SIZE = 50;
export const queueStatusOrder: SentenceStatus[] = ["EM ANDAMENTO", "PENDENTE", "ESTOQUE", "ENTREGUE"];
export const queueStatusModes: QueueStatusMode[] = [...queueStatusOrder, "ALL"];
export const dashboardStatusQueueModes: QueueStatusMode[] = ["PENDENTE", "EM ANDAMENTO", "ESTOQUE", "ALL"];
export type QueueViewMode = "operational" | "dashboard-status";
export type QueueSortDirection = "asc" | "desc";
export type QueueSortKey = "responsible" | "processo" | "status" | "envio_bcc" | "stage_date" | "data_ultimo_evento" | "order_summary" | "origem" | "sla";
export type CumprimentoQueueSlaBucket = "0" | "1" | "2" | "3" | "4" | "5_PLUS";
export type QualidadeQueueSlaBucket = "0_7" | "8_14" | "15_30" | "31_60" | "61_PLUS";
export type QueueSlaBucket = CumprimentoQueueSlaBucket | QualidadeQueueSlaBucket;
export const queueMissingPendenciaValue = "SEM_TIPO";
export type QueuePendenciaFilter = EventPendingOption | typeof queueMissingPendenciaValue;

const queueSortKeys: QueueSortKey[] = ["responsible", "processo", "status", "envio_bcc", "stage_date", "data_ultimo_evento", "order_summary", "origem", "sla"];
export const cumprimentoQueueSlaBuckets: CumprimentoQueueSlaBucket[] = ["0", "1", "2", "3", "4", "5_PLUS"];
export const qualidadeQueueSlaBuckets: QualidadeQueueSlaBucket[] = ["0_7", "8_14", "15_30", "31_60", "61_PLUS"];
export const queuePendenciaFilterValues: QueuePendenciaFilter[] = [
  eventPendingOptions[1],
  eventPendingOptions[0],
  eventPendingOptions[2],
  eventPendingOptions[3],
  queueMissingPendenciaValue,
];

type QueueHrefOptions = {
  stage: WorkflowStage;
  status?: QueueStatusMode;
  query?: string | null;
  cursor?: string | null;
  responsible?: string | null;
  view?: QueueViewMode;
  sort?: QueueSortKey | null;
  sortDirection?: QueueSortDirection | null;
  caseId?: string | null;
  slaBucket?: QueueSlaBucket | null;
  pendencia?: QueuePendenciaFilter | null;
};

const queueCaseIdPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

export function parseQueueStage(value: string | string[] | undefined): WorkflowStage {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "QUALIDADE" ? "QUALIDADE" : "CUMPRIMENTO";
}

export function parseQueueStatus(value: string | string[] | undefined): QueueStatusMode {
  const raw = Array.isArray(value) ? value[0] : value;
  return queueStatusModes.includes(raw as QueueStatusMode) ? (raw as QueueStatusMode) : "EM ANDAMENTO";
}

export function parseQueueView(value: string | string[] | undefined): QueueViewMode {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "dashboard-status" ? "dashboard-status" : "operational";
}

export function parseQueueCursor(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return raw;
  if (/^k\|[0-9]+\|[0-9]{4}-[0-9]{2}-[0-9]{2}\|[0-9a-fA-F-]{36}\|[0-9]+$/.test(raw)) return raw;
  return undefined;
}

export function parseQueueSortKey(value: string | string[] | undefined, stage: WorkflowStage): QueueSortKey | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const sort = queueSortKeys.includes(raw as QueueSortKey) ? (raw as QueueSortKey) : undefined;
  return isQueueSortCompatible(sort, stage) ? sort : undefined;
}

export function parseQueueSortDirection(value: string | string[] | undefined): QueueSortDirection {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "desc" ? "desc" : "asc";
}

export function parseQueueResponsible(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = raw?.trim();
  if (!normalized) return undefined;
  if (normalized === "ALL") return "ALL";
  return normalized;
}

export function parseQueueCaseId(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = raw?.trim();
  if (!normalized || !queueCaseIdPattern.test(normalized)) return undefined;
  return normalized;
}

export function parseQueueSlaBucket(value: string | string[] | undefined, stage: WorkflowStage): QueueSlaBucket | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = raw?.trim();
  const bucket = normalized === "5+" ? "5_PLUS" : normalized;
  return isQueueSlaBucketCompatible(bucket as QueueSlaBucket, stage) ? (bucket as QueueSlaBucket) : undefined;
}

export function parseQueuePendencia(value: string | string[] | undefined): QueuePendenciaFilter | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = raw?.trim();
  if (!normalized) return undefined;
  if (normalized === queueMissingPendenciaValue) return queueMissingPendenciaValue;
  return canonicalizeEventPendencia(normalized) ?? undefined;
}

export function isQueuePendenciaFilter(value: string | null | undefined): value is QueuePendenciaFilter {
  return value === queueMissingPendenciaValue || eventPendingOptions.includes(value as EventPendingOption);
}

export function queuePendenciaLabel(pendencia: QueuePendenciaFilter) {
  if (pendencia === queueMissingPendenciaValue) return "PENDENTE SEM TIPO";
  return `PENDENTE ${pendencia}`;
}

export function queueSlaBucketLabel(bucket: QueueSlaBucket) {
  switch (bucket) {
    case "0":
    case "1":
    case "2":
    case "3":
    case "4":
      return `SLA ${bucket}`;
    case "5_PLUS":
      return "SLA 5+";
    case "0_7":
      return "SLA 7";
    case "8_14":
      return "SLA 14";
    case "15_30":
      return "SLA 30";
    case "31_60":
      return "SLA 60";
    case "61_PLUS":
      return "SLA 60+";
    default:
      return bucket;
  }
}

export function queueSlaBucketsForStage(stage: WorkflowStage): QueueSlaBucket[] {
  return stage === "QUALIDADE" ? qualidadeQueueSlaBuckets : cumprimentoQueueSlaBuckets;
}

export function isQueueSlaBucketCompatible(bucket: QueueSlaBucket | null | undefined, stage: WorkflowStage) {
  if (!bucket) return false;
  return queueSlaBucketsForStage(stage).includes(bucket);
}

export function queueOffset(cursor: string | undefined) {
  if (!cursor) return 0;
  if (cursor.startsWith("k|")) {
    const value = Number(cursor.split("|")[4]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
  const value = Number(cursor);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function queueStatusRank(status: SentenceStatus | null | undefined) {
  const index = queueStatusOrder.indexOf(status as SentenceStatus);
  return index === -1 ? queueStatusOrder.length : index;
}

export function queueStatusLabel(status: QueueStatusMode, pendencia?: QueuePendenciaFilter | null) {
  if (status === "ALL") return "Todos";
  if (status === "PENDENTE" && pendencia) return queuePendenciaLabel(pendencia);
  return status;
}

export function nextQueueSortDirection(currentSort: QueueSortKey | undefined, currentDirection: QueueSortDirection, nextSort: QueueSortKey) {
  return currentSort === nextSort && currentDirection === "asc" ? "desc" : "asc";
}

export function isQueueSortCompatible(sort: QueueSortKey | null | undefined, stage: WorkflowStage) {
  return Boolean(sort)
    && (sort !== "order_summary" || stage === "QUALIDADE")
    && (sort !== "envio_bcc" || stage === "QUALIDADE");
}

export function buildQueueHref({
  stage,
  status = "EM ANDAMENTO",
  query,
  cursor,
  responsible,
  view = "operational",
  sort,
  sortDirection,
  caseId,
  slaBucket,
  pendencia,
}: QueueHrefOptions) {
  const params = new URLSearchParams();
  if (view === "dashboard-status") params.set("view", view);
  params.set("stage", stage);
  params.set("status", status);

  const normalizedQuery = query?.trim();
  const normalizedResponsible = responsible?.trim();
  if (normalizedQuery) params.set("q", normalizedQuery);
  if (normalizedResponsible) params.set("responsible", normalizedResponsible);
  if (sort && isQueueSortCompatible(sort, stage)) {
    params.set("sort", sort);
    params.set("dir", sortDirection === "desc" ? "desc" : "asc");
  }
  if (slaBucket && isQueueSlaBucketCompatible(slaBucket, stage)) params.set("sla", slaBucket);
  if (status === "PENDENTE" && pendencia && isQueuePendenciaFilter(pendencia)) params.set("pendencia", pendencia);
  if (cursor && cursor !== "0") params.set("cursor", cursor);
  if (caseId && queueCaseIdPattern.test(caseId)) params.set("case", caseId);

  return `/fila?${params.toString()}`;
}

export function buildQueueCaseHref(queueHref: string, caseId: string) {
  return buildQueueHrefFromExisting(queueHref, (params) => {
    if (queueCaseIdPattern.test(caseId)) params.set("case", caseId);
  });
}

export function removeQueueCaseHref(queueHref: string) {
  return buildQueueHrefFromExisting(queueHref, (params) => {
    params.delete("case");
  });
}

function buildQueueHrefFromExisting(queueHref: string, update: (params: URLSearchParams) => void) {
  const [pathname, search = ""] = queueHref.split("?");
  const params = new URLSearchParams(search);
  update(params);
  const nextSearch = params.toString();

  return nextSearch ? `${pathname}?${nextSearch}` : pathname;
}
