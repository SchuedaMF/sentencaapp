"use client";

import { createContext, useActionState, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckSquare, Layers, Loader2, X } from "lucide-react";
import { bulkAssignResponsibleAction, type BulkAssignResponsibleState } from "@/app/actions";
import type { QueuePendenciaFilter } from "@/lib/queue";
import type { AssignableProfile, QueueStatusMode, WorkflowStage } from "@/lib/types";

const noResponsibleValue = "__none__";

const initialState: BulkAssignResponsibleState = {
  ok: false,
  message: "",
  updated: 0,
  skipped: 0,
};

type SelectionMode = "selected" | "filtered";

type BulkAssignmentContextValue = {
  action: (payload: FormData) => void;
  allVisibleSelected: boolean;
  assignableProfiles: AssignableProfile[];
  canSubmit: boolean;
  clearSelection: () => void;
  eligibleIds: string[];
  pending: boolean;
  pendencia?: QueuePendenciaFilter;
  query?: string;
  responsible?: string;
  selectedIdList: string[];
  selectedIds: Set<string>;
  selectedVisibleCount: number;
  selectionMode: SelectionMode;
  selectVisiblePage: () => void;
  setFilteredMode: () => void;
  showBulkAssignmentBar: boolean;
  stage: WorkflowStage;
  state: BulkAssignResponsibleState;
  status: QueueStatusMode;
  toggleSentence: (sentenceId: string) => void;
  toggleVisiblePage: () => void;
  totalFiltered: number;
};

const BulkAssignmentContext = createContext<BulkAssignmentContextValue | null>(null);

type BulkAssignmentSelectionProviderProps = {
  assignableProfiles: AssignableProfile[];
  children: ReactNode;
  eligibleIds: string[];
  pendencia?: QueuePendenciaFilter;
  query?: string;
  responsible?: string;
  stage: WorkflowStage;
  status: QueueStatusMode;
  totalFiltered: number;
};

export function BulkAssignmentSelectionProvider({
  assignableProfiles,
  children,
  eligibleIds,
  pendencia,
  query,
  responsible,
  stage,
  status,
  totalFiltered,
}: BulkAssignmentSelectionProviderProps) {
  const [state, action, pending] = useActionState(bulkAssignResponsibleAction, initialState);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("selected");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selectedIdList = useMemo(() => [...selectedIds], [selectedIds]);
  const selectedVisibleCount = selectedIdList.length;
  const allVisibleSelected = eligibleIds.length > 0 && eligibleIds.every((id) => selectedIds.has(id));
  const canSubmit = selectionMode === "filtered" ? totalFiltered > 0 : selectedVisibleCount > 0;
  const showBulkAssignmentBar = selectionMode === "filtered" || selectedVisibleCount > 0;

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

  const value = {
    action,
    allVisibleSelected,
    assignableProfiles,
    canSubmit,
    clearSelection,
    eligibleIds,
    pending,
    pendencia,
    query,
    responsible,
    selectedIdList,
    selectedIds,
    selectedVisibleCount,
    selectionMode,
    selectVisiblePage,
    setFilteredMode: () => setSelectionMode("filtered"),
    showBulkAssignmentBar,
    stage,
    state,
    status,
    toggleSentence,
    toggleVisiblePage,
    totalFiltered,
  };

  return <BulkAssignmentContext.Provider value={value}>{children}</BulkAssignmentContext.Provider>;
}

export function BulkAssignmentBar() {
  const {
    action,
    assignableProfiles,
    canSubmit,
    clearSelection,
    eligibleIds,
    pending,
    pendencia,
    query,
    responsible,
    selectedIdList,
    selectedVisibleCount,
    selectionMode,
    selectVisiblePage,
    setFilteredMode,
    showBulkAssignmentBar,
    stage,
    state,
    status,
    totalFiltered,
  } = useBulkAssignmentContext();

  if (!showBulkAssignmentBar) return null;

  return (
    <form action={action} className="flex flex-wrap items-end gap-3 border border-zinc-800 bg-[#1d1e1c] p-4">
      <input name="stage" type="hidden" value={stage} />
      <input name="statusMode" type="hidden" value={status} />
      <input name="pendencia" type="hidden" value={pendencia ?? ""} />
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
          onClick={setFilteredMode}
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
  );
}

export function BulkAssignmentHeaderCheckbox() {
  const { allVisibleSelected, eligibleIds, toggleVisiblePage } = useBulkAssignmentContext();

  return (
    <input
      aria-label="Selecionar pagina visivel"
      checked={allVisibleSelected}
      className="h-4 w-4 rounded border-zinc-600 bg-zinc-950 accent-sky-500"
      disabled={eligibleIds.length === 0}
      onChange={toggleVisiblePage}
      type="checkbox"
    />
  );
}

export function BulkAssignmentRowCheckbox({ eligible, sentenceId, processo }: { eligible: boolean; sentenceId: string; processo: string }) {
  const { selectedIds, toggleSentence } = useBulkAssignmentContext();

  return (
    <input
      aria-label={`Selecionar caso ${processo}`}
      checked={selectedIds.has(sentenceId)}
      className="h-4 w-4 rounded border-zinc-600 bg-zinc-950 accent-sky-500 disabled:opacity-30"
      data-bulk-row-checkbox
      disabled={!eligible}
      onChange={() => toggleSentence(sentenceId)}
      type="checkbox"
    />
  );
}

function useBulkAssignmentContext() {
  const context = useContext(BulkAssignmentContext);
  if (!context) throw new Error("Bulk assignment controls must be rendered inside BulkAssignmentSelectionProvider.");
  return context;
}
