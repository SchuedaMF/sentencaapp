import Link from "next/link";
import { Suspense } from "react";
import { BarChart3, ChevronLeft, ChevronRight, ClipboardList, ShieldCheck } from "lucide-react";
import { CountBadge } from "@/components/badge";
import { BulkAssignmentQueue } from "@/components/bulk-assignment-queue";
import { LinkPendingIndicator } from "@/components/link-pending-indicator";
import { QueueInlineSearch } from "@/components/queue-search-form";
import { QueueResponsibleFilter } from "@/components/queue-responsible-filter";
import { SentenceTable } from "@/components/sentence-table";
import { getAssignableProfiles, getOperationalQueueItems, getOperationalQueueSummary, type OperationalQueueResult, type OperationalQueueSummary } from "@/lib/data";
import { buildQueueHref, dashboardStatusQueueModes, parseQueueCursor, parseQueueResponsible, parseQueueSortDirection, parseQueueSortKey, parseQueueStage, parseQueueStatus, parseQueueView, queueStatusLabel, queueStatusModes, type QueueSortDirection, type QueueSortKey, type QueueViewMode } from "@/lib/queue";
import type { QueueStatusMode, WorkflowStage } from "@/lib/types";

type QueueSearchParams = {
  stage?: string | string[];
  status?: string | string[];
  q?: string | string[];
  cursor?: string | string[];
  responsible?: string | string[];
  view?: string | string[];
  sort?: string | string[];
  dir?: string | string[];
};

type ParsedQueueParams = {
  stage: WorkflowStage;
  status: QueueStatusMode;
  cursor?: string;
  query?: string;
  responsible?: string;
  sort?: QueueSortKey;
  sortDirection: QueueSortDirection;
  view: QueueViewMode;
};

export async function OperationalQueue({ searchParams }: { searchParams: Promise<QueueSearchParams> }) {
  const rawParams = await searchParams;
  const view = parseQueueView(rawParams.view);
  const status = parseQueueStatus(rawParams.status);
  const stage = parseQueueStage(rawParams.stage);
  const parsedSort = parseQueueSortKey(rawParams.sort, stage);
  const sort = parsedSort ?? "stage_date";
  const params: ParsedQueueParams = {
    stage,
    status: view === "dashboard-status" && status === "ENTREGUE" ? "ALL" : status,
    cursor: parseQueueCursor(rawParams.cursor),
    query: paramValue(rawParams.q)?.trim() || undefined,
    responsible: parseQueueResponsible(rawParams.responsible),
    sort,
    sortDirection: parsedSort ? parseQueueSortDirection(rawParams.dir) : "desc",
    view,
  };

  return <QueueShell params={params} />;
}

function QueueShell({ params }: { params: ParsedQueueParams }) {
  const summaryPromise = getOperationalQueueSummary(params.stage, { query: params.query, responsible: params.responsible, view: params.view });
  const queuePromise = getOperationalQueueItems({
    stage: params.stage,
    statusMode: params.status,
    query: params.query,
    responsible: params.responsible,
    cursor: params.cursor,
    sort: params.sort,
    sortDirection: params.sortDirection,
    view: params.view,
  });
  const summaryKey = `${params.view}:${params.stage}:${params.query ?? ""}:${params.responsible ?? ""}`;
  const resultsKey = `${summaryKey}:${params.status}:${params.cursor ?? ""}:${params.sort ?? ""}:${params.sortDirection}`;

  return (
    <div className="space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <StageSwitcher params={params} />
          <Suspense key={`responsible:${summaryKey}`} fallback={<ResponsibleFilterSkeleton />}>
            <QueueResponsibleFilterControl params={params} summaryPromise={summaryPromise} />
          </Suspense>
        </div>
        <Suspense key={`total:${summaryKey}`} fallback={<QueueTotalSkeleton />}>
          <QueueTotal summaryPromise={summaryPromise} />
        </Suspense>
      </div>

      <Suspense key={`status:${summaryKey}`} fallback={<StatusChips params={params} />}>
        <QueueStatusChips params={params} summaryPromise={summaryPromise} />
      </Suspense>

      {params.view === "dashboard-status" ? <DashboardStatusContext params={params} /> : null}

      <QueueInlineSearch
        className="max-w-3xl"
        initialQuery={params.query}
        responsible={params.responsible}
        stage={params.stage}
        status={params.status}
        view={params.view}
      />

      <Suspense key={`results:${resultsKey}`} fallback={<QueueTableSkeleton />}>
        <QueueResults params={params} queuePromise={queuePromise} summaryPromise={summaryPromise} />
      </Suspense>
    </div>
  );
}

function StageSwitcher({ params }: { params: ParsedQueueParams }) {
  return (
    <div className="inline-flex rounded-md border border-zinc-800 bg-[#1d1e1c] p-1">
      <StageLink
        active={params.stage === "CUMPRIMENTO"}
        href={buildQueueHref({ stage: "CUMPRIMENTO", status: "EM ANDAMENTO", query: params.query, responsible: params.responsible, view: params.view, sort: params.sort, sortDirection: params.sortDirection })}
        icon={<ClipboardList className="h-4 w-4" />}
        label="Cumprimento"
      />
      <StageLink
        active={params.stage === "QUALIDADE"}
        href={buildQueueHref({ stage: "QUALIDADE", status: "EM ANDAMENTO", query: params.query, responsible: params.responsible, view: params.view, sort: params.sort, sortDirection: params.sortDirection })}
        icon={<ShieldCheck className="h-4 w-4" />}
        label="Qualidade"
      />
    </div>
  );
}

async function QueueResponsibleFilterControl({
  params,
  summaryPromise,
}: {
  params: ParsedQueueParams;
  summaryPromise: Promise<OperationalQueueSummary>;
}) {
  const summary = await summaryPromise;
  if (!summary.isManager) return null;

  return (
    <QueueResponsibleFilter
      options={summary.responsible}
      query={params.query}
      responsible={params.responsible}
      stage={params.stage}
      status={params.status}
      sort={params.sort}
      sortDirection={params.sortDirection}
      view={params.view}
    />
  );
}

async function QueueTotal({ summaryPromise }: { summaryPromise: Promise<OperationalQueueSummary> }) {
  const summary = await summaryPromise;

  return (
    <div className="flex items-center gap-2 text-sm text-zinc-300">
      <span>Total</span>
      <CountBadge>{summary.total}</CountBadge>
    </div>
  );
}

async function QueueStatusChips({
  params,
  summaryPromise,
}: {
  params: ParsedQueueParams;
  summaryPromise: Promise<OperationalQueueSummary>;
}) {
  const summary = await summaryPromise;

  return <StatusChips params={params} summary={summary} />;
}

function StatusChips({
  params,
  summary,
}: {
  params: ParsedQueueParams;
  summary?: OperationalQueueSummary;
}) {
  const modes = params.view === "dashboard-status" ? dashboardStatusQueueModes : queueStatusModes;

  return (
    <div aria-label="Status da fila" className="flex flex-wrap gap-2">
      {modes.map((option) => (
        <StatusChip
          active={params.status === option}
          count={summary ? statusCount(option, summary) : undefined}
          href={buildQueueHref({ stage: params.stage, status: option, query: params.query, responsible: params.responsible, view: params.view, sort: params.sort, sortDirection: params.sortDirection })}
          key={option}
          label={queueStatusLabel(option)}
        />
      ))}
    </div>
  );
}

function DashboardStatusContext({ params }: { params: ParsedQueueParams }) {
  const operationalHref = buildQueueHref({
    stage: params.stage,
    status: params.status === "ENTREGUE" ? "EM ANDAMENTO" : params.status,
    query: params.query,
    responsible: params.responsible,
    sort: params.sort,
    sortDirection: params.sortDirection,
  });

  return (
    <div className="flex flex-wrap items-center gap-3 border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-100">
      <span className="inline-flex items-center gap-2 font-semibold">
        <BarChart3 className="h-4 w-4" />
        Dashboard: {params.stage === "CUMPRIMENTO" ? "Cumprimento" : "Qualidade"} / {queueStatusLabel(params.status)}
      </span>
      <Link
        className="relative rounded border border-sky-400/50 px-2 py-1 text-xs font-semibold text-sky-50 transition-colors hover:bg-sky-500/20"
        href={operationalHref}
      >
        Fila operacional
        <LinkPendingIndicator />
      </Link>
    </div>
  );
}

async function QueueResults({
  params,
  queuePromise,
  summaryPromise,
}: {
  params: ParsedQueueParams;
  queuePromise: Promise<OperationalQueueResult>;
  summaryPromise: Promise<OperationalQueueSummary>;
}) {
  const assignableProfilesPromise = params.view === "dashboard-status" ? Promise.resolve([]) : getAssignableProfiles();
  const [queue, assignableProfiles, summary] = await Promise.all([
    queuePromise,
    assignableProfilesPromise,
    summaryPromise,
  ]);
  const orderSummariesByProcess = params.stage === "QUALIDADE" ? queue.orderSummariesByProcess : {};
  const totalFiltered = statusCount(params.status, summary);
  const currentQueueHref = buildQueueHref(params);

  return (
    <>
      {assignableProfiles.length > 0 ? (
        <BulkAssignmentQueue
          assignableProfiles={assignableProfiles}
          query={params.query}
          responsible={params.responsible}
          returnHref={currentQueueHref}
          orderSummariesByProcess={orderSummariesByProcess}
          sort={params.sort}
          sortDirection={params.sortDirection}
          sentences={queue.sentences}
          stage={params.stage}
          status={params.status}
          totalFiltered={totalFiltered}
        />
      ) : (
        <SentenceTable
          orderSummariesByProcess={orderSummariesByProcess}
          query={params.query}
          responsible={params.responsible}
          sort={params.sort}
          sortDirection={params.sortDirection}
          sentences={queue.sentences}
          stage={params.stage}
          status={params.status}
          returnHref={currentQueueHref}
          view={params.view}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-400">
        <span>
          {queue.sentences.length > 0 ? `${queue.offset + 1}-${queue.offset + queue.sentences.length}` : "0"} de {totalFiltered}
        </span>
        <div className="flex gap-2">
          {queue.offset > 0 ? (
            <PaginationLink
              href={buildQueueHref({
                stage: params.stage,
                status: params.status,
                query: params.query,
                responsible: params.responsible,
                cursor: String(Math.max(0, queue.offset - queue.pageSize)),
                sort: params.sort,
                sortDirection: params.sortDirection,
                view: params.view,
              })}
              icon={<ChevronLeft className="h-4 w-4" />}
              label="Anterior"
            />
          ) : null}
          {queue.nextCursor ? (
            <PaginationLink
              href={buildQueueHref({
                stage: params.stage,
                status: params.status,
                query: params.query,
                responsible: params.responsible,
                cursor: queue.nextCursor,
                sort: params.sort,
                sortDirection: params.sortDirection,
                view: params.view,
              })}
              icon={<ChevronRight className="h-4 w-4" />}
              iconAfter
              label="Próxima"
            />
          ) : null}
        </div>
      </div>
    </>
  );
}

export function OperationalQueueSkeleton() {
  return (
    <div className="space-y-5 p-5">
      <QueueControlsSkeleton />
      <QueueTableSkeleton />
    </div>
  );
}

function QueueControlsSkeleton() {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-11 w-64 animate-pulse rounded-md bg-zinc-800" />
          <ResponsibleFilterSkeleton />
        </div>
        <QueueTotalSkeleton />
      </div>
      <div className="flex flex-wrap gap-2">
        {queueStatusModes.map((status) => (
          <div key={status} className="h-9 w-28 animate-pulse rounded-md bg-zinc-900" />
        ))}
      </div>
      <div className="h-16 max-w-3xl animate-pulse rounded-md bg-zinc-900" />
    </>
  );
}

function QueueTotalSkeleton() {
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-300">
      <span>Total</span>
      <span className="h-5 w-10 animate-pulse rounded bg-zinc-800" />
    </div>
  );
}

function ResponsibleFilterSkeleton() {
  return <div className="h-11 w-60 animate-pulse rounded-md bg-zinc-900" />;
}

function QueueTableSkeleton() {
  return (
    <>
      <div className="overflow-hidden border border-zinc-800 bg-[#1d1e1c]">
        <div className="h-12 border-b border-zinc-800 bg-[#222321]" />
        <div className="divide-y divide-zinc-800">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="grid h-14 grid-cols-[230px_145px_145px_150px_1fr] gap-4 px-4 py-3">
              <div className="h-5 animate-pulse rounded bg-zinc-800" />
              <div className="h-5 animate-pulse rounded bg-zinc-800" />
              <div className="h-5 animate-pulse rounded bg-zinc-800" />
              <div className="h-5 animate-pulse rounded bg-zinc-800" />
              <div className="h-5 animate-pulse rounded bg-zinc-800" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="h-5 w-24 animate-pulse rounded bg-zinc-800" />
        <div className="h-9 w-24 animate-pulse rounded-md bg-zinc-800" />
      </div>
    </>
  );
}

function StageLink({
  active,
  href,
  icon,
  label,
}: {
  active: boolean;
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`relative inline-flex h-9 items-center gap-2 rounded px-3 text-sm font-semibold transition-colors ${
        active ? "bg-sky-600 text-white" : "text-zinc-300 hover:bg-sky-500/15 hover:text-sky-100"
      }`}
      href={href}
    >
      {icon}
      {label}
      <LinkPendingIndicator />
    </Link>
  );
}

function StatusChip({
  active,
  count,
  href,
  label,
}: {
  active: boolean;
  count?: number;
  href: string;
  label: string;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`relative inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition-colors ${
        active
          ? "border-sky-500 bg-sky-600 text-white"
          : "border-zinc-800 bg-[#1d1e1c] text-zinc-300 hover:border-sky-500/60 hover:bg-sky-500/15 hover:text-sky-100"
      }`}
      href={href}
    >
      <span>{label}</span>
      {typeof count === "number" ? (
        <CountBadge>{count}</CountBadge>
      ) : (
        <span aria-hidden="true" className="h-4 w-5 rounded bg-zinc-700/60" />
      )}
      <LinkPendingIndicator />
    </Link>
  );
}

function PaginationLink({
  href,
  icon,
  iconAfter = false,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  iconAfter?: boolean;
  label: string;
}) {
  return (
    <Link
      className="relative inline-flex h-9 items-center gap-2 rounded-md border border-zinc-700 px-3 font-semibold text-zinc-200 transition-colors hover:bg-zinc-800"
      href={href}
    >
      {iconAfter ? null : icon}
      {label}
      {iconAfter ? icon : null}
      <LinkPendingIndicator />
    </Link>
  );
}

function statusCount(status: QueueStatusMode, summary: { statusCounts: Record<string, number>; total: number }) {
  if (status === "ALL") return summary.total;
  return summary.statusCounts[status] ?? 0;
}

function paramValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
