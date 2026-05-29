import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  FileText,
  FolderOpen,
  Search,
  XCircle,
} from "lucide-react";
import { ClickableTableRow } from "@/components/clickable-table-row";
import { LinkPendingIndicator } from "@/components/link-pending-indicator";
import { getObfImportFiles, getObfImportVerificationItems, getObfImportVerificationSummary } from "@/lib/data";
import { formatDate } from "@/lib/normalization";
import type {
  ObfImportFileRecord,
  ObfImportFilesResult,
  ObfImportStatus,
  ObfImportStatusMode,
  ObfImportVerificationRecord,
  ObfImportVerificationResult,
  ObfImportVerificationSummary,
  ObfImportViewMode,
} from "@/lib/types";

type ImportacaoSearchParams = {
  view?: string | string[];
  from?: string | string[];
  to?: string | string[];
  status?: string | string[];
  q?: string | string[];
  office?: string | string[];
  cursor?: string | string[];
  batch?: string | string[];
  period?: string | string[];
};

type ParsedImportacaoParams = {
  view: ObfImportViewMode;
  from: string;
  to: string;
  status: ObfImportStatusMode;
  query?: string;
  office?: string;
  cursor?: string;
  batchKey?: string;
  needsRedirect: boolean;
};

const importStatuses: ObfImportStatus[] = ["importado", "rejeitado", "pendente"];
const statusLabels: Record<ObfImportStatusMode, string> = {
  all: "Todos",
  importado: "Importado",
  rejeitado: "Rejeitado",
  pendente: "Pendente",
};

export const unstable_instant = {
  prefetch: "runtime",
  unstable_disableValidation: true,
  samples: [
    { searchParams: { view: "arquivos", from: null, to: null, status: null, q: null, office: null, cursor: null } },
    { searchParams: { view: "linhas", from: null, to: null, status: "rejeitado", q: null, office: null, cursor: null } },
  ],
};

export default function ImportacaoPage({
  searchParams,
}: {
  searchParams: Promise<ImportacaoSearchParams>;
}) {
  return (
    <>
      <div className="border-b border-zinc-800 px-5 py-4">
        <h1 className="text-base font-semibold leading-6">Importacao OBF</h1>
      </div>
      <Suspense fallback={<ImportacaoSkeleton />}>
        <ImportacaoContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ImportacaoContent({ searchParams }: { searchParams: Promise<ImportacaoSearchParams> }) {
  await connection();
  const rawParams = await searchParams;
  const params = parseImportacaoParams(rawParams);

  if (params.needsRedirect) {
    redirect(buildImportacaoHref(params));
  }

  const summaryPromise = getObfImportVerificationSummary(toDataFilters(params));
  const resultPromise = params.view === "arquivos"
    ? getObfImportFiles(toDataFilters(params))
    : getObfImportVerificationItems(toDataFilters(params));
  const [summary, result] = await Promise.all([summaryPromise, resultPromise]);

  if (!summary.isManager) {
    return (
      <div className="p-5">
        <div className="flex gap-3 border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>A importacao OBF esta disponivel apenas para administradores e gestores.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-5">
      <SummaryCards summary={summary} />
      <ImportFilters params={params} summary={summary} />
      <ViewSwitcher params={params} />
      {params.view === "arquivos" ? (
        <ImportFileResults filesResult={result as ObfImportFilesResult} params={params} />
      ) : (
        <ImportRowResults params={params} rowsResult={result as ObfImportVerificationResult} />
      )}
    </div>
  );
}

function SummaryCards({ summary }: { summary: ObfImportVerificationSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <MetricCard accent="sky" label="Linhas" value={summary.total} />
      <MetricCard accent="green" label="Importadas" value={summary.statusCounts.importado} />
      <MetricCard accent="red" label="Rejeitadas" value={summary.statusCounts.rejeitado} />
      <MetricCard accent="amber" label="Pendentes" value={summary.statusCounts.pendente} />
      <MetricCard accent="zinc" detail={formatDateTime(summary.latestVerifiedAt)} label="Ultimo lote" valueText={formatDate(summary.latestVerifiedAt)} />
    </div>
  );
}

function MetricCard({
  accent,
  detail,
  label,
  value,
  valueText,
}: {
  accent: "amber" | "green" | "red" | "sky" | "zinc";
  detail?: string;
  label: string;
  value?: number;
  valueText?: string;
}) {
  const accentClass = {
    amber: "bg-amber-400",
    green: "bg-emerald-400",
    red: "bg-red-400",
    sky: "bg-sky-400",
    zinc: "bg-zinc-500",
  }[accent];

  return (
    <section className="relative overflow-hidden border border-zinc-800 bg-[#1d1e1c] p-4">
      <div className={`absolute inset-x-0 top-0 h-1 ${accentClass}`} />
      <div className="text-xs font-semibold uppercase text-zinc-500">{label}</div>
      <div className="mt-2 min-h-9">
        <span className="font-mono text-3xl font-semibold text-zinc-100">
          {typeof value === "number" ? formatNumber(value) : valueText ?? "-"}
        </span>
        {detail && detail !== valueText ? <div className="mt-1 truncate text-xs text-zinc-400">{detail}</div> : null}
      </div>
    </section>
  );
}

function ImportFilters({
  params,
  summary,
}: {
  params: ParsedImportacaoParams;
  summary: ObfImportVerificationSummary;
}) {
  const resetHref = buildImportacaoHref({
    ...params,
    batchKey: undefined,
    cursor: undefined,
    from: todayInSaoPaulo(),
    office: undefined,
    query: undefined,
    status: "all",
    to: todayInSaoPaulo(),
    view: "arquivos",
  });
  const officeOptions = ensureSelectedOffice(summary.offices, params.office);

  return (
    <form action="/importacao" className="border border-zinc-800 bg-[#1d1e1c] p-4" method="get">
      <input name="view" type="hidden" value={params.view} />
      {params.batchKey ? <input name="batch" type="hidden" value={params.batchKey} /> : null}
      <div className="grid gap-3 md:grid-cols-[150px_150px_170px_minmax(220px,1fr)_220px_auto] md:items-end">
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">De</span>
          <input
            className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none [color-scheme:dark] focus:border-sky-500"
            defaultValue={params.from}
            name="from"
            type="date"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Ate</span>
          <input
            className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none [color-scheme:dark] focus:border-sky-500"
            defaultValue={params.to}
            name="to"
            type="date"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Status</span>
          <select
            className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none [color-scheme:dark] focus:border-sky-500"
            defaultValue={params.status}
            name="status"
          >
            <option value="all">Todos</option>
            {importStatuses.map((status) => (
              <option key={status} value={status}>{statusLabels[status]}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Busca</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 pl-9 pr-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-sky-500"
              defaultValue={params.query}
              name="q"
              placeholder="Processo, arquivo, motivo"
              type="search"
            />
          </div>
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Escritorio</span>
          <select
            className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none [color-scheme:dark] focus:border-sky-500"
            defaultValue={params.office ?? ""}
            name="office"
          >
            <option value="">Todos</option>
            {officeOptions.map(([office, count]) => (
              <option key={office} value={office}>{office} ({formatNumber(count)})</option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-sky-500 bg-sky-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-sky-500"
            type="submit"
          >
            Aplicar
          </button>
          <Link
            className="relative inline-flex h-10 items-center gap-2 rounded-md border border-zinc-700 px-3 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800"
            href={resetHref}
          >
            Limpar
            <LinkPendingIndicator />
          </Link>
        </div>
      </div>
    </form>
  );
}

function ViewSwitcher({ params }: { params: ParsedImportacaoParams }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="inline-flex rounded-md border border-zinc-800 bg-[#1d1e1c] p-1">
        <ViewLink
          active={params.view === "arquivos"}
          href={buildImportacaoHref({ ...params, batchKey: undefined, cursor: undefined, view: "arquivos" })}
          icon={<FolderOpen className="h-4 w-4" />}
          label="Arquivos"
        />
        <ViewLink
          active={params.view === "linhas" && !params.batchKey}
          href={buildImportacaoHref({ ...params, batchKey: undefined, cursor: undefined, view: "linhas" })}
          icon={<Database className="h-4 w-4" />}
          label="Todas as linhas"
        />
      </div>
      {params.batchKey ? <FileBreadcrumb params={params} /> : null}
    </div>
  );
}

function ViewLink({
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

function FileBreadcrumb({ params }: { params: ParsedImportacaoParams }) {
  return (
    <Link
      className="relative inline-flex h-9 items-center gap-2 rounded-md border border-zinc-700 px-3 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800"
      href={buildImportacaoHref({ ...params, batchKey: undefined, view: "arquivos" })}
    >
      <ArrowLeft className="h-4 w-4" />
      Voltar para arquivos
      <LinkPendingIndicator />
    </Link>
  );
}

function ImportFileResults({
  filesResult,
  params,
}: {
  filesResult: ObfImportFilesResult;
  params: ParsedImportacaoParams;
}) {
  return (
    <>
      <div className="overflow-hidden border border-zinc-800 bg-[#1d1e1c]">
        <div className="overflow-x-auto">
          <table className="min-w-[1180px] w-full table-fixed text-left text-xs">
            <thead className="bg-[#222321] text-xs uppercase text-zinc-300">
              <tr className="[&>th]:border-b [&>th]:border-r [&>th]:border-zinc-800 [&>th]:px-4 [&>th]:py-3">
                <th className="w-[320px]">Arquivo</th>
                <th className="w-[170px]">Importacao</th>
                <th className="w-[170px]">Origem</th>
                <th className="w-[110px]">Total</th>
                <th className="w-[270px]">Composicao</th>
                <th className="w-[160px]">Avisos</th>
                <th className="w-[90px]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filesResult.files.map((file) => {
                const href = buildImportacaoHref({
                  ...params,
                  batchKey: file.batch_key,
                  cursor: undefined,
                  view: "linhas",
                });

                return (
                  <ClickableTableRow
                    className="group cursor-pointer transition-colors hover:bg-sky-500/10 active:bg-sky-500/15 focus-visible:bg-sky-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
                    href={href}
                    key={file.batch_key}
                    label={`Abrir arquivo ${file.file_name}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <FileText className="h-5 w-5 shrink-0 text-sky-300" />
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-zinc-100">{file.file_name}</div>
                          <div className="truncate font-mono text-[11px] text-zinc-500">{formatFileMeta(file)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-200">{formatDateTime(file.imported_at)}</td>
                    <td className="truncate px-4 py-3 text-zinc-300">{file.source_kind ?? "OBF"}</td>
                    <td className="px-4 py-3 font-mono text-zinc-100">{formatNumber(toNumber(file.total_rows))}</td>
                    <td className="px-4 py-3">
                      <StatusComposition file={file} />
                    </td>
                    <td className="px-4 py-3">
                      <WarningSummary file={file} />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        aria-label={`Abrir arquivo ${file.file_name}`}
                        className="relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 text-sky-200 transition-colors group-hover:border-sky-500/60 group-hover:bg-sky-500/15"
                        href={href}
                        prefetch={false}
                        title="Abrir"
                      >
                        <ArrowUpRight className="h-4 w-4" />
                        <LinkPendingIndicator />
                      </Link>
                    </td>
                  </ClickableTableRow>
                );
              })}
            </tbody>
          </table>
        </div>
        {filesResult.files.length === 0 ? <EmptyState message="Nenhum arquivo OBF encontrado para os filtros atuais." /> : null}
      </div>
      <Pagination
        currentCount={filesResult.files.length}
        nextCursor={filesResult.nextCursor}
        offset={filesResult.offset}
        pageSize={filesResult.pageSize}
        params={params}
        total={filesResult.total}
      />
    </>
  );
}

function StatusComposition({ file }: { file: ObfImportFileRecord }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <ObfStatusBadge count={toNumber(file.importado_count)} status="importado" />
      <ObfStatusBadge count={toNumber(file.rejeitado_count)} status="rejeitado" />
      <ObfStatusBadge count={toNumber(file.pendente_count)} status="pendente" />
    </div>
  );
}

function WarningSummary({ file }: { file: ObfImportFileRecord }) {
  const warnings = toNumber(file.warning_count);
  const inconsistencies = toNumber(file.inconsistency_count);

  if (warnings === 0 && inconsistencies === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-200">
        <CheckCircle2 className="h-4 w-4" />
        Sem avisos
      </span>
    );
  }

  return (
    <div className="space-y-1 text-zinc-200">
      <span className="inline-flex items-center gap-1.5">
        <AlertTriangle className="h-4 w-4 text-amber-300" />
        {formatNumber(warnings)} avisos
      </span>
      <div className="text-xs text-zinc-400">{formatNumber(inconsistencies)} inconsistencias</div>
    </div>
  );
}

function ImportRowResults({
  params,
  rowsResult,
}: {
  params: ParsedImportacaoParams;
  rowsResult: ObfImportVerificationResult;
}) {
  const currentHref = buildImportacaoHref(params);
  const title = params.batchKey ? selectedFileTitle(rowsResult.records, params.batchKey) : "Todas as linhas OBF";

  return (
    <>
      {params.batchKey ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
          <span className="inline-flex min-w-0 items-center gap-2 font-semibold">
            <FileText className="h-4 w-4 shrink-0" />
            <span className="truncate">{title}</span>
          </span>
          <span className="font-mono text-xs text-sky-200/80">{params.batchKey}</span>
        </div>
      ) : null}

      <div className="overflow-hidden border border-zinc-800 bg-[#1d1e1c]">
        <div className="overflow-x-auto">
          <table className="min-w-[1370px] w-full table-fixed text-left text-xs">
            <thead className="bg-[#222321] text-xs uppercase text-zinc-300">
              <tr className="[&>th]:border-b [&>th]:border-r [&>th]:border-zinc-800 [&>th]:px-4 [&>th]:py-3">
                <th className="w-[230px]">Processo</th>
                <th className="w-[145px]">Status</th>
                <th className="w-[190px]">Escritorio</th>
                <th className="w-[180px]">Fluxo</th>
                <th className="w-[110px]">Envio BCC</th>
                <th className="w-[110px]">Linha</th>
                <th className="w-[260px]">Arquivo</th>
                <th className="w-[240px]">Motivo</th>
                <th className="w-[95px]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {rowsResult.records.map((row) => {
                const href = row.imported_record_id ? sentenceHref(row.imported_record_id, currentHref) : null;
                const cells = (
                  <>
                    <td className="px-4 py-3 font-mono font-semibold text-zinc-50">{row.processo ?? "-"}</td>
                    <td className="px-4 py-3"><ObfStatusBadge status={row.status_importacao} /></td>
                    <td className="truncate px-4 py-3 text-zinc-200">{row.escritorio ?? "-"}</td>
                    <td className="truncate px-4 py-3 text-zinc-300">{row.tipo_fluxo ?? "-"}</td>
                    <td className="px-4 py-3 text-zinc-200">{formatDate(row.envio_bcc)}</td>
                    <td className="px-4 py-3 font-mono text-zinc-300">{row.linha_origem ?? "-"}</td>
                    <td className="truncate px-4 py-3 text-zinc-300" title={row.arquivo_rel ?? undefined}>{row.arquivo_rel ?? "-"}</td>
                    <td className="truncate px-4 py-3 text-zinc-300" title={row.motivo_status ?? undefined}>{row.motivo_status ?? "-"}</td>
                    <td className="px-4 py-3">
                      {href ? (
                        <Link
                          aria-label={`Abrir sentenca ${row.processo ?? row.imported_record_id}`}
                          className="relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 text-sky-200 transition-colors group-hover:border-sky-500/60 group-hover:bg-sky-500/15"
                          href={href}
                          prefetch={false}
                          title="Abrir sentenca"
                        >
                          <ArrowUpRight className="h-4 w-4" />
                          <LinkPendingIndicator />
                        </Link>
                      ) : (
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-800 text-zinc-600" title="Sem sentenca importada">
                          <XCircle className="h-4 w-4" />
                        </span>
                      )}
                    </td>
                  </>
                );

                return href ? (
                  <ClickableTableRow
                    className="group cursor-pointer transition-colors hover:bg-sky-500/10 active:bg-sky-500/15 focus-visible:bg-sky-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
                    href={href}
                    key={row.id}
                    label={`Abrir sentenca ${row.processo ?? row.imported_record_id}`}
                  >
                    {cells}
                  </ClickableTableRow>
                ) : (
                  <tr className="group" key={row.id}>{cells}</tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rowsResult.records.length === 0 ? <EmptyState message="Nenhuma linha OBF encontrada para os filtros atuais." /> : null}
      </div>
      <Pagination
        currentCount={rowsResult.records.length}
        nextCursor={rowsResult.nextCursor}
        offset={rowsResult.offset}
        pageSize={rowsResult.pageSize}
        params={params}
        total={rowsResult.total}
      />
    </>
  );
}

function ObfStatusBadge({ count, status }: { count?: number; status: ObfImportStatus }) {
  const tone = {
    importado: "border-emerald-500/35 bg-emerald-500/12 text-emerald-200",
    rejeitado: "border-red-500/35 bg-red-500/12 text-red-200",
    pendente: "border-amber-500/35 bg-amber-500/12 text-amber-200",
  }[status];

  return (
    <span className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-xs font-semibold ${tone}`}>
      {statusLabels[status]}
      {typeof count === "number" ? <span className="font-mono text-[11px] opacity-80">{formatNumber(count)}</span> : null}
    </span>
  );
}

function Pagination({
  currentCount,
  nextCursor,
  offset,
  pageSize,
  params,
  total,
}: {
  currentCount: number;
  nextCursor: string | null;
  offset: number;
  pageSize: number;
  params: ParsedImportacaoParams;
  total: number;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-400">
      <span>
        {currentCount > 0 ? `${formatNumber(offset + 1)}-${formatNumber(offset + currentCount)}` : "0"} de {formatNumber(total)}
      </span>
      <div className="flex gap-2">
        {offset > 0 ? (
          <PaginationLink
            href={buildImportacaoHref({ ...params, cursor: String(Math.max(0, offset - pageSize)) })}
            icon={<ChevronLeft className="h-4 w-4" />}
            label="Anterior"
          />
        ) : null}
        {nextCursor ? (
          <PaginationLink
            href={buildImportacaoHref({ ...params, cursor: nextCursor })}
            icon={<ChevronRight className="h-4 w-4" />}
            iconAfter
            label="Proxima"
          />
        ) : null}
      </div>
    </div>
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

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 p-10 text-center text-zinc-400">
      <CalendarDays className="h-8 w-8 text-zinc-600" />
      <p>{message}</p>
    </div>
  );
}

function ImportacaoSkeleton() {
  return (
    <div className="space-y-5 p-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div className="h-[96px] animate-pulse border border-zinc-800 bg-[#1d1e1c]" key={index} />
        ))}
      </div>
      <div className="h-28 animate-pulse border border-zinc-800 bg-[#1d1e1c]" />
      <div className="h-11 w-72 animate-pulse rounded-md bg-zinc-800" />
      <div className="overflow-hidden border border-zinc-800 bg-[#1d1e1c]">
        <div className="h-12 border-b border-zinc-800 bg-[#222321]" />
        <div className="divide-y divide-zinc-800">
          {Array.from({ length: 8 }).map((_, index) => (
            <div className="grid h-16 grid-cols-[320px_170px_170px_110px_1fr] gap-4 px-4 py-3" key={index}>
              <div className="h-5 animate-pulse rounded bg-zinc-800" />
              <div className="h-5 animate-pulse rounded bg-zinc-800" />
              <div className="h-5 animate-pulse rounded bg-zinc-800" />
              <div className="h-5 animate-pulse rounded bg-zinc-800" />
              <div className="h-5 animate-pulse rounded bg-zinc-800" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function parseImportacaoParams(rawParams: ImportacaoSearchParams): ParsedImportacaoParams {
  const today = todayInSaoPaulo();
  const rawView = paramValue(rawParams.view);
  const rawStatus = paramValue(rawParams.status);
  const rawFrom = sanitizeDate(paramValue(rawParams.from));
  const rawTo = sanitizeDate(paramValue(rawParams.to));
  const view: ObfImportViewMode = rawView === "linhas" ? "linhas" : "arquivos";
  const status = rawStatus && (rawStatus === "all" || importStatuses.includes(rawStatus as ObfImportStatus))
    ? rawStatus as ObfImportStatusMode
    : "all";
  const from = rawFrom ?? rawTo ?? today;
  const to = rawTo ?? rawFrom ?? today;
  const query = sanitizeSearch(paramValue(rawParams.q));
  const office = sanitizeOffice(paramValue(rawParams.office));
  const cursor = sanitizeCursor(paramValue(rawParams.cursor));
  const batchKey = view === "linhas" ? sanitizeBatchKey(paramValue(rawParams.batch)) : undefined;

  return {
    batchKey,
    cursor,
    from,
    needsRedirect: shouldRedirectImportacao(rawParams, { batchKey, cursor, from, office, query, status, to, view }),
    office,
    query,
    status,
    to,
    view,
  };
}

function shouldRedirectImportacao(rawParams: ImportacaoSearchParams, params: Omit<ParsedImportacaoParams, "needsRedirect">) {
  if (paramValue(rawParams.period)) return true;
  if (paramValue(rawParams.view) !== params.view) return true;
  if (paramValue(rawParams.from) !== params.from) return true;
  if (paramValue(rawParams.to) !== params.to) return true;
  if (paramValue(rawParams.status) === "all") return true;
  if ((paramValue(rawParams.status) ?? "all") !== params.status) return true;
  if (paramValue(rawParams.q) !== undefined && !params.query) return true;
  if ((paramValue(rawParams.q)?.trim() || undefined) !== params.query) return true;
  if (paramValue(rawParams.office) !== undefined && !params.office) return true;
  if ((paramValue(rawParams.office)?.trim() || undefined) !== params.office) return true;
  if (paramValue(rawParams.cursor) === "0") return true;
  if ((paramValue(rawParams.cursor) || undefined) !== params.cursor) return true;
  if (params.view === "arquivos" && paramValue(rawParams.batch) !== undefined) return true;
  if (params.view === "linhas" && paramValue(rawParams.batch) !== undefined && !params.batchKey) return true;
  if (params.view === "linhas" && (paramValue(rawParams.batch) || undefined) !== params.batchKey) return true;
  return false;
}

function buildImportacaoHref(params: Omit<ParsedImportacaoParams, "needsRedirect">) {
  const query = new URLSearchParams();
  query.set("view", params.view);
  query.set("from", params.from);
  query.set("to", params.to);
  if (params.status !== "all") query.set("status", params.status);
  if (params.query) query.set("q", params.query);
  if (params.office) query.set("office", params.office);
  if (params.view === "linhas" && params.batchKey) query.set("batch", params.batchKey);
  if (params.cursor && params.cursor !== "0") query.set("cursor", params.cursor);
  return `/importacao?${query.toString()}`;
}

function toDataFilters(params: ParsedImportacaoParams) {
  return {
    batchKey: params.view === "linhas" ? params.batchKey : undefined,
    cursor: params.cursor,
    from: params.from,
    office: params.office,
    query: params.query,
    status: params.status,
    to: params.to,
  };
}

function sentenceHref(sentenceId: string, currentHref: string) {
  const query = new URLSearchParams({ from: currentHref });
  return `/sentencas/${sentenceId}?${query.toString()}`;
}

function ensureSelectedOffice(offices: Array<[string, number]>, selected: string | undefined) {
  if (!selected || offices.some(([office]) => office === selected)) return offices;
  return [[selected, 0] as [string, number], ...offices];
}

function selectedFileTitle(records: ObfImportVerificationRecord[], batchKey: string) {
  const firstRecord = records.find((record) => record.batch_key === batchKey) ?? records[0];
  return firstRecord?.arquivo_rel ?? "Linhas do arquivo";
}

function formatFileMeta(file: ObfImportFileRecord) {
  const parts = [
    file.import_batch_id ? `lote ${file.import_batch_id}` : file.batch_key,
    formatBytes(file.file_size_bytes),
  ].filter(Boolean);
  return parts.join(" | ");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value);
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function formatNumber(value: number) {
  return value.toLocaleString("pt-BR");
}

function formatBytes(value: number | string | null | undefined) {
  const bytes = toNumber(value);
  if (!bytes) return null;
  if (bytes < 1024) return `${formatNumber(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${units[unitIndex]}`;
}

function toNumber(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function sanitizeDate(value: string | undefined) {
  const date = value?.trim();
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

function sanitizeSearch(value: string | undefined) {
  const normalized = value?.replace(/[%(),]/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 120) : undefined;
}

function sanitizeOffice(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 120) : undefined;
}

function sanitizeCursor(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized || normalized === "0") return undefined;
  return /^\d+$/.test(normalized) ? normalized : undefined;
}

function sanitizeBatchKey(value: string | undefined) {
  const batchKey = value?.trim();
  if (!batchKey) return undefined;
  if (/^batch:[0-9a-fA-F-]{36}$/.test(batchKey)) return batchKey.toLowerCase();
  if (/^file:[0-9a-fA-F]{32}$/.test(batchKey)) return batchKey.toLowerCase();
  return undefined;
}

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function paramValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
