import { ClipboardList, Clock3, Layers3 } from "lucide-react";
import type { SalesforceOrderGroup, SalesforceOrdersSummary } from "@/lib/types";

export function SalesforceOrdersPanel({ summary }: { summary: SalesforceOrdersSummary }) {
  return (
    <section className="border border-zinc-800 bg-[#1d1e1c] p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ClipboardList className="h-5 w-5 text-emerald-300" />
            Ordens Salesforce
          </h2>
        </div>
        <div className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-2 py-1 text-xs font-semibold text-zinc-300">
          <Clock3 className="h-3.5 w-3.5 text-zinc-500" />
          {summary.latestImportedAt ? formatDateTime(summary.latestImportedAt) : "Sem import"}
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Metric label="Total" value={summary.totalRows} tone="text-zinc-100" />
        <Metric label="Abertas" value={summary.openRows} tone="text-amber-200" />
        <Metric label="Fechadas" value={summary.closedRows} tone="text-emerald-200" />
        <Metric label="Canceladas" value={summary.canceledRows} tone="text-red-200" />
      </div>

      {summary.groups.length > 0 ? (
        <div className="space-y-3">
          {summary.groups.map((group) => (
            <OrderGroupItem group={group} key={group.key} />
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-zinc-700 px-4 py-5 text-sm text-zinc-400">
          Nenhuma ordem Salesforce encontrada para este processo no ultimo import.
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2">
      <div className="text-xs font-semibold uppercase text-zinc-500">{label}</div>
      <div className={`mt-1 font-mono text-xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function OrderGroupItem({ group }: { group: SalesforceOrderGroup }) {
  const row = group.latestRow;
  const stateText = group.orderStates.length > 0 ? group.orderStates.join(" / ") : "-";
  const orderStatusText = group.orderStatuses.length > 0 ? group.orderStatuses.join(" / ") : "-";
  const description = row.observations || row.case_observations || row.observations_prefixed;

  return (
    <article className="rounded-md border border-zinc-800 bg-zinc-950/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-zinc-50">{group.displayOrderNumber}</span>
            <SalesforceStatusBadge open={group.isOpen} status={row.case_status} />
            {group.rowCount > 1 ? (
              <span className="inline-flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-xs font-semibold text-zinc-300">
                <Layers3 className="h-3 w-3" />
                {group.rowCount} linhas
              </span>
            ) : null}
          </div>
          <div className="mt-2 grid gap-2 text-sm text-zinc-300 md:grid-cols-2">
            <Info label="Caso SF" value={row.salesforce_case_number ?? "-"} mono />
            <Info label="Abertura" value={formatDateTime(row.opened_at)} />
            <Info label="Submotivo" value={row.subreason ?? "-"} />
            <Info label="Estado da ordem" value={stateText} />
            <Info label="Status da ordem" value={orderStatusText} />
            <Info label="Municipio" value={row.municipality ?? "-"} />
          </div>
        </div>
      </div>

      {description ? <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-400">{description}</p> : null}
    </article>
  );
}

function SalesforceStatusBadge({ open, status }: { open: boolean; status: string | null }) {
  return (
    <span className={`inline-flex h-6 items-center rounded border px-2 text-xs font-semibold ${open ? "border-amber-500/35 bg-amber-500/12 text-amber-200" : "border-emerald-500/35 bg-emerald-500/12 text-emerald-200"}`}>
      {status ?? "Sem status"}
    </span>
  );
}

function Info({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase text-zinc-500">{label}</div>
      <div className={`mt-0.5 break-words text-zinc-200 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}
