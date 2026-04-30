import Link from "next/link";
import { ArrowUpRight, CalendarClock } from "lucide-react";
import { OrderSummaryCell } from "@/components/order-summary-cell";
import { SortableQueueHeader } from "@/components/sortable-queue-header";
import { StatusBadge } from "@/components/badge";
import { ClickableTableRow } from "@/components/clickable-table-row";
import { buildQueueHref, nextQueueSortDirection, type QueueSortDirection, type QueueSortKey, type QueueViewMode } from "@/lib/queue";
import { currentStageResponsible, currentStageStatus, formatDate, queueSlaDays, queueStageDate } from "@/lib/normalization";
import type { QueueStatusMode, SalesforceOrderQueueSummary, SentenceRecord, WorkflowStage } from "@/lib/types";

type SentenceTableProps = {
  orderSummariesByProcess?: Record<string, SalesforceOrderQueueSummary>;
  query?: string;
  responsible?: string;
  sort?: QueueSortKey;
  sortDirection?: QueueSortDirection;
  sentences: SentenceRecord[];
  stage: WorkflowStage;
  status?: QueueStatusMode;
  returnHref?: string;
  view?: QueueViewMode;
};

export function SentenceTable({
  orderSummariesByProcess = {},
  query,
  responsible,
  sort,
  sortDirection = "asc",
  sentences,
  stage,
  status = "EM ANDAMENTO",
  returnHref,
  view = "operational",
}: SentenceTableProps) {
  const stageDateHeader = stage === "CUMPRIMENTO" ? "Envio BCC" : "Cumprimento";
  const showOrderSummary = stage === "QUALIDADE";
  const sortHeader = (key: QueueSortKey, label: string) => (
    <SortableQueueHeader
      active={sort === key}
      direction={sort === key ? sortDirection : "asc"}
      href={buildQueueHref({
        stage,
        status,
        query,
        responsible,
        view,
        sort: key,
        sortDirection: nextQueueSortDirection(sort, sortDirection, key),
      })}
      label={label}
    />
  );

  return (
    <div className="overflow-hidden border border-zinc-800 bg-[#1d1e1c]">
      <div className="overflow-x-auto">
        <table className={`${showOrderSummary ? "min-w-[1380px]" : "min-w-[1200px]"} w-full table-fixed text-left text-sm`}>
          <thead className="bg-[#222321] text-xs uppercase text-zinc-300">
            <tr className="[&>th]:border-b [&>th]:border-r [&>th]:border-zinc-800 [&>th]:px-4 [&>th]:py-3">
              <th aria-sort={sortAria("responsible", sort, sortDirection)} className="w-[180px]">{sortHeader("responsible", "Responsavel")}</th>
              <th aria-sort={sortAria("processo", sort, sortDirection)} className="w-[230px]">{sortHeader("processo", "Processo")}</th>
              <th aria-sort={sortAria("status", sort, sortDirection)} className="w-[145px]">{sortHeader("status", "Status")}</th>
              <th aria-sort={sortAria("stage_date", sort, sortDirection)} className="w-[145px]">{sortHeader("stage_date", stageDateHeader)}</th>
              <th aria-sort={sortAria("data_ultimo_evento", sort, sortDirection)} className="w-[145px]">{sortHeader("data_ultimo_evento", "Ultimo evento")}</th>
              {showOrderSummary ? <th aria-sort={sortAria("order_summary", sort, sortDirection)} className="w-[180px]">{sortHeader("order_summary", "Resumo ordem")}</th> : null}
              <th aria-sort={sortAria("origem", sort, sortDirection)} className="w-[160px]">{sortHeader("origem", "Origem")}</th>
              <th aria-sort={sortAria("sla", sort, sortDirection)} className="w-[110px]">{sortHeader("sla", "SLA")}</th>
              <th className="w-[80px]"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {sentences.map((sentence) => {
              const href = sentenceHref(sentence.id, returnHref);

              return (
                <ClickableTableRow
                  key={sentence.id}
                  href={href}
                  label={`Abrir caso ${sentence.processo}`}
                  className="group cursor-pointer transition-colors hover:bg-sky-500/10 active:bg-sky-500/15 focus-visible:bg-sky-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
                >
                  <td className="truncate px-4 py-3 font-semibold text-zinc-100">{currentStageResponsible(sentence, stage) ?? "-"}</td>
                  <td className="px-4 py-3 font-mono font-semibold text-zinc-50">{sentence.processo}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={currentStageStatus(sentence, stage)} />
                  </td>
                  <td className="px-4 py-3 text-zinc-200">{formatDate(queueStageDate(sentence, stage))}</td>
                  <td className="px-4 py-3 text-zinc-200">{formatDate(sentence.data_ultimo_evento)}</td>
                  {showOrderSummary ? (
                    <td className="px-4 py-3 text-zinc-200">
                      <OrderSummaryCell summary={orderSummariesByProcess[sentence.processo]} />
                    </td>
                  ) : null}
                  <td className="truncate px-4 py-3 text-zinc-300">{sentence.origem_normalized ?? "-"}</td>
                  <td className="px-4 py-3 text-zinc-200">
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="h-4 w-4 text-amber-300" />
                      {queueSlaDays(sentence, stage) ?? "-"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      aria-label={`Abrir caso ${sentence.processo}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 text-sky-200 transition-colors group-hover:border-sky-500/60 group-hover:bg-sky-500/15"
                      href={href}
                      prefetch={false}
                      title="Abrir caso"
                    >
                      <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  </td>
                </ClickableTableRow>
              );
            })}
          </tbody>
        </table>
      </div>
      {sentences.length === 0 ? <div className="p-10 text-center text-zinc-400">Nenhum item encontrado.</div> : null}
    </div>
  );
}

function sortAria(key: QueueSortKey, currentSort: QueueSortKey | undefined, direction: QueueSortDirection) {
  if (currentSort !== key) return "none";
  return direction === "desc" ? "descending" : "ascending";
}

function sentenceHref(id: string, returnHref: string | undefined) {
  if (!returnHref) return `/sentencas/${id}`;

  const params = new URLSearchParams({ from: returnHref });
  return `/sentencas/${id}?${params.toString()}`;
}
