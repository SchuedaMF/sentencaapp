"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { ArrowUpRight, CalendarClock, CheckSquare, Layers, Loader2, X } from "lucide-react";
import { bulkAssignResponsibleAction, type BulkAssignResponsibleState } from "@/app/actions";
import { OrderSummaryCell } from "@/components/order-summary-cell";
import { SortableQueueHeader } from "@/components/sortable-queue-header";
import { StatusBadge } from "@/components/badge";
import { ClickableTableRow } from "@/components/clickable-table-row";
import { buildQueueHref, nextQueueSortDirection, type QueueSortDirection, type QueueSortKey } from "@/lib/queue";
import { currentStageResponsible, currentStageStatus, formatDate, queueSlaDays, queueStageDate } from "@/lib/normalization";
import type { AssignableProfile, QueueStatusMode, SalesforceOrderQueueSummary, SentenceRecord, WorkflowStage } from "@/lib/types";

const noResponsibleValue = "__none__";

const initialState: BulkAssignResponsibleState = {
  ok: false,
  message: "",
  updated: 0,
  skipped: 0,
};

type SelectionMode = "selected" | "filtered";

type BulkAssignmentQueueProps = {
  assignableProfiles: AssignableProfile[];
  query?: string;
  responsible?: string;
  returnHref?: string;
  orderSummariesByProcess?: Record<string, SalesforceOrderQueueSummary>;
  sort?: QueueSortKey;
  sortDirection?: QueueSortDirection;
  sentences: SentenceRecord[];
  stage: WorkflowStage;
  status: QueueStatusMode;
  totalFiltered: number;
};

export function BulkAssignmentQueue({
  assignableProfiles,
  query,
  responsible,
  returnHref,
  orderSummariesByProcess = {},
  sort,
  sortDirection = "asc",
  sentences,
  stage,
  status,
  totalFiltered,
}: BulkAssignmentQueueProps) {
  const [state, action, pending] = useActionState(bulkAssignResponsibleAction, initialState);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("selected");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const eligibleIds = useMemo(
    () => sentences.filter((sentence) => isBulkAssignable(sentence, stage)).map((sentence) => sentence.id),
    [sentences, stage],
  );
  const selectedIdList = useMemo(() => [...selectedIds], [selectedIds]);
  const selectedVisibleCount = selectedIdList.length;
  const allVisibleSelected = eligibleIds.length > 0 && eligibleIds.every((id) => selectedIds.has(id));
  const canSubmit = selectionMode === "filtered" ? totalFiltered > 0 : selectedVisibleCount > 0;
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
        sort: key,
        sortDirection: nextQueueSortDirection(sort, sortDirection, key),
      })}
      label={label}
    />
  );

  function toggleSentence(sentenceId: string) {
    setSelectionMode("selected");
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(sentenceId)) {
        next.delete(sentenceId);
      } else {
        next.add(sentenceId);
      }
      return next;
    });
  }

  function selectVisiblePage() {
    setSelectionMode("selected");
    setSelectedIds(new Set(eligibleIds));
  }

  function clearSelection() {
    setSelectionMode("selected");
    setSelectedIds(new Set());
  }

  function toggleVisiblePage() {
    if (allVisibleSelected) {
      clearSelection();
    } else {
      selectVisiblePage();
    }
  }

  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-end gap-3 border border-zinc-800 bg-[#1d1e1c] p-4">
        <input name="stage" type="hidden" value={stage} />
        <input name="statusMode" type="hidden" value={status} />
        <input name="query" type="hidden" value={query ?? ""} />
        <input name="responsible" type="hidden" value={responsible ?? ""} />
        <input name="mode" type="hidden" value={selectionMode} />
        {selectionMode === "selected"
          ? selectedIdList.map((sentenceId) => <input key={sentenceId} name="sentenceIds" type="hidden" value={sentenceId} />)
          : null}

        <div className="flex flex-wrap gap-2">
          <button
            className={`inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition-colors ${
              selectionMode === "selected" && selectedVisibleCount > 0
                ? "border-sky-500 bg-sky-600 text-white"
                : "border-zinc-700 text-zinc-200 hover:bg-zinc-800"
            }`}
            disabled={pending || eligibleIds.length === 0}
            onClick={selectVisiblePage}
            type="button"
          >
            <CheckSquare className="h-4 w-4" />
            Selecionar pagina
          </button>
          <button
            className={`inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition-colors ${
              selectionMode === "filtered"
                ? "border-sky-500 bg-sky-600 text-white"
                : "border-zinc-700 text-zinc-200 hover:bg-zinc-800"
            }`}
            disabled={pending || totalFiltered === 0}
            onClick={() => setSelectionMode("filtered")}
            type="button"
          >
            <Layers className="h-4 w-4" />
            Todos do filtro
          </button>
          <button
            aria-label="Limpar selecao"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-700 text-zinc-300 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pending || (selectionMode === "selected" && selectedVisibleCount === 0)}
            onClick={clearSelection}
            title="Limpar selecao"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="min-w-[240px] flex-1 md:max-w-sm">
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Responsavel</span>
          <select
            className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none [color-scheme:dark] focus:border-sky-500"
            defaultValue={noResponsibleValue}
            disabled={pending}
            name="targetProfileId"
          >
            <option className="bg-zinc-950 text-zinc-100" value={noResponsibleValue}>Sem responsavel</option>
            {assignableProfiles.map((profile) => (
              <option className="bg-zinc-950 text-zinc-100" key={profile.id} value={profile.id}>
                {profile.displayName} - {profile.role}
              </option>
            ))}
          </select>
        </label>

        <button
          className="inline-flex h-10 items-center gap-2 rounded-md bg-sky-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending || !canSubmit}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckSquare className="h-4 w-4" />}
          Aplicar
        </button>

        <div className="min-w-[180px] text-sm text-zinc-400">
          {selectionMode === "filtered" ? `${totalFiltered} no filtro` : `${selectedVisibleCount} selecionado(s)`}
        </div>

        {state.message ? (
          <div className={`w-full border px-3 py-2 text-sm ${state.ok ? "border-emerald-700 bg-emerald-950/40 text-emerald-200" : "border-red-800 bg-red-950/40 text-red-200"}`}>
            {state.message}
          </div>
        ) : null}
      </form>

      <div className="overflow-hidden border border-zinc-800 bg-[#1d1e1c]">
        <div className="overflow-x-auto">
          <table className={`${showOrderSummary ? "min-w-[1440px]" : "min-w-[1250px]"} w-full table-fixed text-left text-sm`}>
            <thead className="bg-[#222321] text-xs uppercase text-zinc-300">
              <tr className="[&>th]:border-b [&>th]:border-r [&>th]:border-zinc-800 [&>th]:px-4 [&>th]:py-3">
                <th className="w-[56px]">
                  <div data-row-interactive="true">
                    <input
                      aria-label="Selecionar pagina visivel"
                      checked={allVisibleSelected}
                      className="h-4 w-4 rounded border-zinc-600 bg-zinc-950 accent-sky-500"
                      disabled={eligibleIds.length === 0}
                      onChange={toggleVisiblePage}
                      type="checkbox"
                    />
                  </div>
                </th>
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
                const eligible = isBulkAssignable(sentence, stage);
                const selected = selectedIds.has(sentence.id);

                return (
                  <ClickableTableRow
                    key={sentence.id}
                    href={href}
                    label={`Abrir caso ${sentence.processo}`}
                    className={`group cursor-pointer transition-colors hover:bg-sky-500/10 active:bg-sky-500/15 focus-visible:bg-sky-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${
                      selected ? "bg-sky-500/10" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div data-row-interactive="true">
                        <input
                          aria-label={`Selecionar caso ${sentence.processo}`}
                          checked={selected}
                          className="h-4 w-4 rounded border-zinc-600 bg-zinc-950 accent-sky-500 disabled:opacity-30"
                          disabled={!eligible}
                          onChange={() => toggleSentence(sentence.id)}
                          type="checkbox"
                        />
                      </div>
                    </td>
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
    </div>
  );
}

function isBulkAssignable(sentence: SentenceRecord, stage: WorkflowStage) {
  const status = currentStageStatus(sentence, stage);
  if (status !== "ESTOQUE" && status !== "EM ANDAMENTO") return false;
  return stage !== "QUALIDADE" || sentence.cumprimento_status === "ENTREGUE";
}

function sentenceHref(id: string, returnHref: string | undefined) {
  if (!returnHref) return `/sentencas/${id}`;

  const params = new URLSearchParams({ from: returnHref });
  return `/sentencas/${id}?${params.toString()}`;
}

function sortAria(key: QueueSortKey, currentSort: QueueSortKey | undefined, direction: QueueSortDirection) {
  if (currentSort !== key) return "none";
  return direction === "desc" ? "descending" : "ascending";
}
