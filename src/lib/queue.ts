import type { QueueStatusMode, SentenceStatus, WorkflowStage } from "@/lib/types";

export const QUEUE_PAGE_SIZE = 50;
export const queueStatusOrder: SentenceStatus[] = ["EM ANDAMENTO", "PENDENTE", "ESTOQUE", "ENTREGUE"];
export const queueStatusModes: QueueStatusMode[] = [...queueStatusOrder, "ALL"];
export const dashboardStatusQueueModes: QueueStatusMode[] = ["PENDENTE", "EM ANDAMENTO", "ESTOQUE", "ALL"];
export type QueueViewMode = "operational" | "dashboard-status";
export type QueueSortDirection = "asc" | "desc";
export type QueueSortKey = "responsible" | "processo" | "status" | "stage_date" | "data_ultimo_evento" | "order_summary" | "origem" | "sla";

const queueSortKeys: QueueSortKey[] = ["responsible", "processo", "status", "stage_date", "data_ultimo_evento", "order_summary", "origem", "sla"];

type QueueHrefOptions = {
  stage: WorkflowStage;
  status?: QueueStatusMode;
  query?: string | null;
  cursor?: string | null;
  responsible?: string | null;
  view?: QueueViewMode;
  sort?: QueueSortKey | null;
  sortDirection?: QueueSortDirection | null;
};

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
  if (!normalized || normalized === "ALL") return undefined;
  return normalized;
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

export function queueStatusLabel(status: QueueStatusMode) {
  if (status === "ALL") return "Todos";
  return status;
}

export function nextQueueSortDirection(currentSort: QueueSortKey | undefined, currentDirection: QueueSortDirection, nextSort: QueueSortKey) {
  return currentSort === nextSort && currentDirection === "asc" ? "desc" : "asc";
}

export function isQueueSortCompatible(sort: QueueSortKey | null | undefined, stage: WorkflowStage) {
  return Boolean(sort) && (sort !== "order_summary" || stage === "QUALIDADE");
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
}: QueueHrefOptions) {
  const params = new URLSearchParams();
  if (view === "dashboard-status") params.set("view", view);
  params.set("stage", stage);
  params.set("status", status);

  const normalizedQuery = query?.trim();
  const normalizedResponsible = responsible?.trim();
  if (normalizedQuery) params.set("q", normalizedQuery);
  if (normalizedResponsible && normalizedResponsible !== "ALL") params.set("responsible", normalizedResponsible);
  if (sort && isQueueSortCompatible(sort, stage)) {
    params.set("sort", sort);
    params.set("dir", sortDirection === "desc" ? "desc" : "asc");
  }
  if (cursor && cursor !== "0") params.set("cursor", cursor);

  return `/fila?${params.toString()}`;
}
