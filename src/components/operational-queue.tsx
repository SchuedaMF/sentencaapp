import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AlertTriangle, BarChart3, CalendarClock, ChevronLeft, ChevronRight, ClipboardList, ShieldCheck, X } from "lucide-react";
import { CountBadge } from "@/components/badge";
import { BulkAssignmentQueue } from "@/components/bulk-assignment-queue";
import { LinkPendingIndicator } from "@/components/link-pending-indicator";
import { QueueResponsibleFilter } from "@/components/queue-responsible-filter";
import { SentenceDetailView } from "@/components/sentence-detail";
import { SentenceTable } from "@/components/sentence-table";
import { getAssignableProfiles, getOperationalQueueItems, getOperationalQueueSlaCounts, getOperationalQueueSummary, type OperationalQueueResult, type OperationalQueueSlaCounts, type OperationalQueueSummary } from "@/lib/data";
import { buildQueueHref, parseQueueCaseId, parseQueueCursor, parseQueuePendencia, parseQueueResponsible, parseQueueSlaBucket, parseQueueSortDirection, parseQueueSortKey, parseQueueStage, parseQueueStatus, parseQueueView, queueMissingPendenciaValue, queuePendenciaFilterValues, queueSlaBucketLabel, queueSlaBucketsForStage, queueStatusLabel, removeQueueCaseHref, type QueuePendenciaFilter, type QueueSlaBucket, type QueueSortDirection, type QueueSortKey, type QueueViewMode } from "@/lib/queue";
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
  case?: string | string[];
  sla?: string | string[];
  pendencia?: string | string[];
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
  selectedCaseId?: string;
  hasInvalidCaseParam: boolean;
  slaBucket?: QueueSlaBucket;
  pendencia?: QueuePendenciaFilter;
};

type StatusChipOption = {
  key: string;
  label: string;
  status: QueueStatusMode;
  pendencia?: QueuePendenciaFilter;
};

export async function OperationalQueue({ searchParams }: { searchParams: Promise<QueueSearchParams> }) {
  await connection();
  const rawParams = await searchParams;
  const view = parseQueueView(rawParams.view);
  const status = parseQueueStatus(rawParams.status);
  const stage = parseQueueStage(rawParams.stage);
  const normalizedStatus = view === "dashboard-status" && status === "ENTREGUE" ? "ALL" : status;
  const parsedSort = parseQueueSortKey(rawParams.sort, stage);
  const sort = parsedSort ?? "stage_date";
  const rawCaseId = paramValue(rawParams.case)?.trim();
  const selectedCaseId = parseQueueCaseId(rawParams.case);
  const params: ParsedQueueParams = {
    stage,
    status: normalizedStatus,
    cursor: parseQueueCursor(rawParams.cursor),
    query: paramValue(rawParams.q)?.trim() || undefined,
    responsible: parseQueueResponsible(rawParams.responsible),
    sort,
    sortDirection: parsedSort ? parseQueueSortDirection(rawParams.dir) : "desc",
    view,
    selectedCaseId,
    hasInvalidCaseParam: Boolean(rawCaseId && !selectedCaseId),
    slaBucket: parseQueueSlaBucket(rawParams.sla, stage),
    pendencia: normalizedStatus === "PENDENTE" ? parseQueuePendencia(rawParams.pendencia) : undefined,
  };

  return <QueueShell params={params} />;
}

function QueueShell({ params }: { params: ParsedQueueParams }) {
  const summaryPromise = getOperationalQueueSummary(params.stage, { query: params.query, responsible: params.responsible, slaBucket: params.slaBucket, view: params.view });
  const slaCountsPromise = getOperationalQueueSlaCounts(params.stage, { statusMode: params.status, pendencia: params.pendencia, query: params.query, responsible: params.responsible, view: params.view });
  const queuePromise = getOperationalQueueItems({
    stage: params.stage,
    statusMode: params.status,
    pendencia: params.pendencia,
    query: params.query,
    responsible: params.responsible,
    cursor: params.cursor,
    slaBucket: params.slaBucket,
    sort: params.sort,
    sortDirection: params.sortDirection,
    view: params.view,
  });
  const summaryKey = `${params.view}:${params.stage}:${params.query ?? ""}:${params.responsible ?? ""}:${params.slaBucket ?? ""}`;
  const slaCountsKey = `${params.view}:${params.stage}:${params.status}:${params.pendencia ?? ""}:${params.query ?? ""}:${params.responsible ?? ""}`;
  const resultsKey = `${summaryKey}:${params.status}:${params.pendencia ?? ""}:${params.cursor ?? ""}:${params.sort ?? ""}:${params.sortDirection}`;
  const currentQueueHref = removeQueueCaseHref(buildQueueHref({ ...params, caseId: params.selectedCaseId }));
  const showCaseDrawer = params.hasInvalidCaseParam || Boolean(params.selectedCaseId);

  return (
    <div className={showCaseDrawer ? "p-5 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(420px,560px)] xl:items-start xl:gap-5" : "p-5"}>
      <div className="min-w-0 space-y-5">
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

        <Suspense key={`sla:${slaCountsKey}`} fallback={<SlaChips params={params} />}>
          <QueueSlaChips params={params} slaCountsPromise={slaCountsPromise} />
        </Suspense>

        <Suspense key={`results:${resultsKey}`} fallback={<QueueTableSkeleton />}>
          <QueueResults params={params} queuePromise={queuePromise} summaryPromise={summaryPromise} />
        </Suspense>
      </div>

      {showCaseDrawer ? (
        <QueueCaseDrawer
          caseId={params.selectedCaseId}
          closeHref={currentQueueHref}
          invalid={params.hasInvalidCaseParam}
          returnHref={currentQueueHref}
          stage={params.stage}
        />
      ) : null}
    </div>
  );
}

function StageSwitcher({ params }: { params: ParsedQueueParams }) {
  return (
    <div className="inline-flex rounded-md border border-zinc-800 bg-[#1d1e1c] p-1">
      <StageLink
        active={params.stage === "CUMPRIMENTO"}
        href={buildQueueHref({ stage: "CUMPRIMENTO", status: "EM ANDAMENTO", query: params.query, responsible: params.responsible, slaBucket: params.slaBucket, view: params.view, sort: params.sort, sortDirection: params.sortDirection })}
        icon={<ClipboardList className="h-4 w-4" />}
        label="Cumprimento"
      />
      <StageLink
        active={params.stage === "QUALIDADE"}
        href={buildQueueHref({ stage: "QUALIDADE", status: "EM ANDAMENTO", query: params.query, responsible: params.responsible, slaBucket: params.slaBucket, view: params.view, sort: params.sort, sortDirection: params.sortDirection })}
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
  const currentResponsible = params.responsible ?? summary.defaultResponsible ?? undefined;

  return (
    <QueueResponsibleFilter
      options={summary.responsible}
      query={params.query}
      pendencia={params.pendencia}
      responsible={currentResponsible}
      slaBucket={params.slaBucket}
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
  const options = primaryStatusChipOptions();
  const pendingOptions = summary && params.status === "PENDENTE"
    ? pendingTypeChipOptions(summary, params.pendencia)
    : [];

  return (
    <div className="space-y-2">
      <div aria-label="Status da fila" className="flex flex-wrap gap-2">
        {options.map((option) => (
          <StatusChip
            active={params.status === option.status}
            count={summary ? statusCount(option.status, summary) : undefined}
            href={buildQueueHref({ stage: params.stage, status: option.status, query: params.query, responsible: params.responsible, slaBucket: params.slaBucket, view: params.view, sort: params.sort, sortDirection: params.sortDirection })}
            key={option.key}
            label={option.label}
          />
        ))}
      </div>

      {pendingOptions.length > 0 ? (
        <div aria-label="Tipo de pendência" className="flex flex-wrap gap-1.5">
          {pendingOptions.map((option) => (
            <PendingTypeChip
              active={params.pendencia === option.pendencia}
              count={summary?.pendenciaCounts[option.pendencia]}
              href={buildQueueHref({ stage: params.stage, status: "PENDENTE", pendencia: option.pendencia, query: params.query, responsible: params.responsible, slaBucket: params.slaBucket, view: params.view, sort: params.sort, sortDirection: params.sortDirection })}
              key={option.key}
              label={option.label}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SlaChips({
  params,
  counts,
}: {
  params: ParsedQueueParams;
  counts?: OperationalQueueSlaCounts;
}) {
  return (
    <div aria-label="Filtro por SLA" className="flex flex-wrap items-center gap-2">
      <span className="inline-flex h-9 items-center gap-2 px-1 text-xs font-semibold uppercase text-zinc-400">
        <CalendarClock className="h-4 w-4 text-amber-300" />
        SLA
      </span>
      {queueSlaBucketsForStage(params.stage).map((bucket) => {
        const active = params.slaBucket === bucket;

        return (
          <SlaChip
            active={active}
            count={counts?.[bucket]}
            href={buildQueueHref({
              stage: params.stage,
              status: params.status,
              pendencia: params.pendencia,
              query: params.query,
              responsible: params.responsible,
              slaBucket: active ? null : bucket,
              view: params.view,
              sort: params.sort,
              sortDirection: params.sortDirection,
            })}
            key={bucket}
            label={queueSlaBucketLabel(bucket)}
          />
        );
      })}
    </div>
  );
}

async function QueueSlaChips({
  params,
  slaCountsPromise,
}: {
  params: ParsedQueueParams;
  slaCountsPromise: Promise<OperationalQueueSlaCounts>;
}) {
  const counts = await slaCountsPromise;
  return <SlaChips params={params} counts={counts} />;
}

function DashboardStatusContext({ params }: { params: ParsedQueueParams }) {
  const operationalHref = buildQueueHref({
    stage: params.stage,
    status: params.status === "ENTREGUE" ? "EM ANDAMENTO" : params.status,
    pendencia: params.pendencia,
    query: params.query,
    responsible: params.responsible,
    slaBucket: params.slaBucket,
    sort: params.sort,
    sortDirection: params.sortDirection,
  });

  return (
    <div className="flex flex-wrap items-center gap-3 border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-100">
      <span className="inline-flex items-center gap-2 font-semibold">
        <BarChart3 className="h-4 w-4" />
        Dashboard: {params.stage === "CUMPRIMENTO" ? "Cumprimento" : "Qualidade"} / {queueStatusLabel(params.status, params.pendencia)}
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
  const totalFiltered = statusCount(params.status, summary, params.pendencia);
  const currentQueueHref = buildQueueHref(params);

  return (
    <>
      {assignableProfiles.length > 0 ? (
        <BulkAssignmentQueue
          assignableProfiles={assignableProfiles}
          query={params.query}
          pendencia={params.pendencia}
          responsible={params.responsible}
          returnHref={currentQueueHref}
          orderSummariesByProcess={orderSummariesByProcess}
          sort={params.sort}
          sortDirection={params.sortDirection}
          slaBucket={params.slaBucket}
          sentences={queue.sentences}
          selectedSentenceId={params.selectedCaseId}
          stage={params.stage}
          status={params.status}
          totalFiltered={totalFiltered}
        />
      ) : (
        <SentenceTable
          orderSummariesByProcess={orderSummariesByProcess}
          query={params.query}
          pendencia={params.pendencia}
          responsible={params.responsible}
          slaBucket={params.slaBucket}
          sort={params.sort}
          sortDirection={params.sortDirection}
          sentences={queue.sentences}
          selectedSentenceId={params.selectedCaseId}
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
                pendencia: params.pendencia,
                query: params.query,
                responsible: params.responsible,
                slaBucket: params.slaBucket,
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
                pendencia: params.pendencia,
                query: params.query,
                responsible: params.responsible,
                slaBucket: params.slaBucket,
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

function QueueCaseDrawer({
  caseId,
  closeHref,
  invalid,
  returnHref,
  stage,
}: {
  caseId?: string;
  closeHref: string;
  invalid: boolean;
  returnHref: string;
  stage: WorkflowStage;
}) {
  return (
    <QueueCaseFrame closeHref={closeHref}>
      {invalid || !caseId ? (
        <QueueCaseError
          closeHref={closeHref}
          message="O identificador informado na URL nao corresponde a um caso valido."
          title="Caso invalido"
        />
      ) : (
        <Suspense key={`case:${caseId}:${stage}`} fallback={<QueueCaseDrawerSkeleton closeHref={closeHref} />}>
          <QueueCaseDetail caseId={caseId} closeHref={closeHref} returnHref={returnHref} stage={stage} />
        </Suspense>
      )}
    </QueueCaseFrame>
  );
}

function QueueCaseFrame({ children, closeHref }: { children: React.ReactNode; closeHref: string }) {
  return (
    <>
      <Link
        aria-label="Fechar caso"
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm xl:hidden"
        href={closeHref}
        scroll={false}
      />
      <aside className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto border-l border-zinc-800 bg-[#171817] shadow-2xl sm:w-[580px] sm:max-w-[92vw] xl:sticky xl:top-20 xl:z-auto xl:h-[calc(100vh-5rem)] xl:w-auto xl:max-w-none xl:shadow-none">
        {children}
      </aside>
    </>
  );
}

async function QueueCaseDetail({
  caseId,
  closeHref,
  returnHref,
  stage,
}: {
  caseId: string;
  closeHref: string;
  returnHref: string;
  stage: WorkflowStage;
}) {
  return (
    <SentenceDetailView
      activeStage={stage}
      closeHref={closeHref}
      missingFallback={(
        <QueueCaseError
          closeHref={closeHref}
          message="Nao encontramos esse caso para o seu acesso atual."
          title="Caso nao encontrado"
        />
      )}
      returnHref={returnHref}
      sentenceId={caseId}
      variant="drawer"
    />
  );
}

function QueueCaseError({
  closeHref,
  message,
  title,
}: {
  closeHref: string;
  message: string;
  title: string;
}) {
  return (
    <>
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-zinc-800 bg-[#20211f] px-4 py-3">
        <h2 className="text-lg font-semibold text-zinc-50">{title}</h2>
        <Link
          aria-label="Fechar caso"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          href={closeHref}
          scroll={false}
          title="Fechar"
        >
          <X className="h-4 w-4" />
        </Link>
      </div>
      <div className="p-4">
        <div className="flex gap-3 border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{message}</p>
        </div>
      </div>
    </>
  );
}

function QueueCaseDrawerSkeleton({ closeHref }: { closeHref: string }) {
  return (
    <>
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-800 bg-[#20211f] px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="h-6 w-64 max-w-full animate-pulse rounded bg-zinc-800" />
          <div className="mt-2 h-4 w-48 max-w-full animate-pulse rounded bg-zinc-800" />
        </div>
        <Link
          aria-label="Fechar caso"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          href={closeHref}
          scroll={false}
          title="Fechar"
        >
          <X className="h-4 w-4" />
        </Link>
      </div>
      <div className="space-y-5 p-4">
        <div className="h-56 animate-pulse border border-zinc-800 bg-[#1d1e1c]" />
        <div className="h-36 animate-pulse border border-zinc-800 bg-[#1d1e1c]" />
        <div className="h-72 animate-pulse border border-zinc-800 bg-[#1d1e1c]" />
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
        {primaryStatusChipOptions().map((option) => (
          <div key={option.key} className="h-9 w-28 animate-pulse rounded-md bg-zinc-900" />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="h-9 w-16 animate-pulse rounded bg-zinc-900" />
        {queueSlaBucketsForStage("CUMPRIMENTO").map((bucket) => (
          <div key={bucket} className="h-9 w-12 animate-pulse rounded-full bg-zinc-900" />
        ))}
      </div>
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

function PendingTypeChip({
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
      className={`relative inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors ${
        active
          ? "border-sky-400/80 bg-sky-500/20 text-sky-50"
          : "border-zinc-800 bg-[#171816] text-zinc-400 hover:border-sky-500/50 hover:bg-sky-500/10 hover:text-sky-100"
      }`}
      href={href}
    >
      <span>{label}</span>
      {typeof count === "number" ? (
        <span className="rounded bg-zinc-700/80 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-100">{count}</span>
      ) : null}
      <LinkPendingIndicator />
    </Link>
  );
}

function SlaChip({
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
      className={`relative inline-flex h-9 min-w-12 items-center justify-center gap-3 rounded-full border px-4 text-sm font-semibold transition-colors ${
        active
          ? "border-amber-300 bg-amber-300 text-zinc-950"
          : "border-zinc-800 bg-[#1d1e1c] text-zinc-300 hover:border-amber-300/70 hover:bg-amber-300/10 hover:text-amber-100"
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

function primaryStatusChipOptions(): StatusChipOption[] {
  return [
    { key: "EM ANDAMENTO", label: queueStatusLabel("EM ANDAMENTO"), status: "EM ANDAMENTO" },
    { key: "PENDENTE", label: queueStatusLabel("PENDENTE"), status: "PENDENTE" },
    { key: "ESTOQUE", label: queueStatusLabel("ESTOQUE"), status: "ESTOQUE" },
    { key: "ALL", label: queueStatusLabel("ALL"), status: "ALL" },
  ];
}

function pendingTypeChipOptions(summary: OperationalQueueSummary, selected?: QueuePendenciaFilter): Array<Required<Pick<StatusChipOption, "key" | "label" | "pendencia">>> {
  return queuePendenciaFilterValues
    .filter((pendencia) => {
      const count = summary.pendenciaCounts[pendencia] ?? 0;
      return count > 0 || selected === pendencia;
    })
    .map((pendencia) => ({
      key: `PENDENTE:${pendencia}`,
      label: pendingTypeLabel(pendencia),
      pendencia,
    }));
}

function pendingTypeLabel(pendencia: QueuePendenciaFilter) {
  switch (pendencia) {
    case "ÁREA":
      return "Área";
    case "QUESTIONAMENTO AO ESCRITÓRIO":
      return "Questionado escritório";
    case "PETICIONADO":
      return "Peticionado";
    case "CUMPRIMENTO INCORRETO":
      return "Cumprimento incorreto";
    case queueMissingPendenciaValue:
      return "Sem tipo";
    default:
      return pendencia;
  }
}

function statusCount(status: QueueStatusMode, summary: { statusCounts: Record<string, number>; pendenciaCounts: Record<string, number>; total: number }, pendencia?: QueuePendenciaFilter) {
  if (status === "ALL") return summary.total;
  if (status === "PENDENTE" && pendencia) return summary.pendenciaCounts[pendencia] ?? 0;
  return summary.statusCounts[status] ?? 0;
}

function paramValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
