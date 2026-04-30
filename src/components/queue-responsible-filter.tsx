"use client";

import { UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useTransition, type ChangeEvent } from "react";
import { buildQueueHref, type QueueSortDirection, type QueueSortKey, type QueueViewMode } from "@/lib/queue";
import type { QueueStatusMode, WorkflowStage } from "@/lib/types";

type QueueResponsibleFilterProps = {
  options: Array<[string, number]>;
  query?: string;
  responsible?: string;
  stage: WorkflowStage;
  status: QueueStatusMode;
  sort?: QueueSortKey;
  sortDirection?: QueueSortDirection;
  view?: QueueViewMode;
};

export function QueueResponsibleFilter({
  options,
  query,
  responsible,
  stage,
  status,
  sort,
  sortDirection = "asc",
  view = "operational",
}: QueueResponsibleFilterProps) {
  const router = useRouter();
  const selectId = useId();
  const [isPending, startTransition] = useTransition();
  const currentValue = responsible?.trim() || "ALL";
  const responsibleOptions = options.filter(([value]) => value.trim().length > 0);
  const hasCurrentOption = currentValue === "ALL" || responsibleOptions.some(([value]) => value === currentValue);
  const visibleOptions = hasCurrentOption ? responsibleOptions : [[currentValue, 0] as [string, number], ...responsibleOptions];

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextResponsible = event.target.value === "ALL" ? undefined : event.target.value;
    startTransition(() => {
      router.push(buildQueueHref({ stage, status, query, responsible: nextResponsible, view, sort, sortDirection }));
    });
  }

  return (
    <div
      className={`inline-flex h-11 min-w-[240px] items-center gap-2 rounded-md border border-zinc-800 bg-[#1d1e1c] px-3 ${
        isPending ? "opacity-70" : ""
      }`}
    >
      <UserRound className="h-4 w-4 shrink-0 text-zinc-500" />
      <label className="shrink-0 text-xs font-semibold uppercase text-zinc-400" htmlFor={selectId}>
        Responsavel
      </label>
      <select
        className="min-w-0 flex-1 bg-[#1d1e1c] text-sm font-semibold text-zinc-100 outline-none [color-scheme:dark] disabled:cursor-wait"
        disabled={isPending}
        id={selectId}
        onChange={handleChange}
        value={currentValue}
      >
        <option className="bg-zinc-950 text-zinc-100" value="ALL">Todos</option>
        {visibleOptions.map(([value, count]) => (
          <option className="bg-zinc-950 text-zinc-100" key={value} value={value}>
            {value} ({count})
          </option>
        ))}
      </select>
    </div>
  );
}
