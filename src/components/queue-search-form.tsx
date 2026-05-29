"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, type FormEvent } from "react";
import { buildQueueHref, parseQueuePendencia, parseQueueResponsible, parseQueueSlaBucket, parseQueueSortDirection, parseQueueSortKey, parseQueueStage, parseQueueStatus, parseQueueView, type QueuePendenciaFilter, type QueueSlaBucket, type QueueSortDirection, type QueueSortKey, type QueueViewMode } from "@/lib/queue";
import type { QueueStatusMode, WorkflowStage } from "@/lib/types";

type SearchFormProps = {
  className?: string;
  initialQuery: string;
  label?: string;
  onSearch: (query: string) => void;
};

export function GlobalQueueSearch({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentQuery = searchParams.get("q") ?? "";

  function handleSearch(query: string) {
    const onQueuePage = pathname === "/fila";
    const stage = onQueuePage ? parseQueueStage(searchParams.get("stage") ?? undefined) : "CUMPRIMENTO";
    const status = onQueuePage ? parseQueueStatus(searchParams.get("status") ?? undefined) : "EM ANDAMENTO";
    const responsible = onQueuePage ? parseQueueResponsible(searchParams.get("responsible") ?? undefined) : undefined;
    const view = onQueuePage ? parseQueueView(searchParams.get("view") ?? undefined) : "operational";
    const sort = onQueuePage ? parseQueueSortKey(searchParams.get("sort") ?? undefined, stage) : undefined;
    const sortDirection = onQueuePage ? parseQueueSortDirection(searchParams.get("dir") ?? undefined) : "asc";
    const slaBucket = onQueuePage ? parseQueueSlaBucket(searchParams.get("sla") ?? undefined, stage) : undefined;
    const pendencia = onQueuePage && status === "PENDENTE" ? parseQueuePendencia(searchParams.get("pendencia") ?? undefined) : undefined;

    router.push(buildQueueHref({ stage, status, pendencia, query, responsible, slaBucket, view, sort, sortDirection }));
  }

  return (
    <QueueSearchFields
      className={className}
      initialQuery={currentQuery}
      onSearch={handleSearch}
    />
  );
}

export function QueueInlineSearch({
  className = "",
  initialQuery,
  pendencia,
  responsible,
  slaBucket,
  stage,
  status,
  sort,
  sortDirection = "asc",
  view = "operational",
}: {
  className?: string;
  initialQuery?: string;
  pendencia?: QueuePendenciaFilter;
  responsible?: string;
  slaBucket?: QueueSlaBucket;
  stage: WorkflowStage;
  status: QueueStatusMode;
  sort?: QueueSortKey;
  sortDirection?: QueueSortDirection;
  view?: QueueViewMode;
}) {
  const router = useRouter();

  function handleSearch(query: string) {
    router.push(buildQueueHref({ stage, status, pendencia, query, responsible, slaBucket, view, sort, sortDirection }));
  }

  return (
    <QueueSearchFields
      className={className}
      initialQuery={initialQuery ?? ""}
      label="Busca"
      onSearch={handleSearch}
    />
  );
}

function QueueSearchFields({ className = "", initialQuery, label, onSearch }: SearchFormProps) {
  const inputId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const query = String(formData.get("q") ?? "");
    onSearch(query.trim());
  }

  return (
    <form action="/fila" className={`w-full ${className}`} onSubmit={handleSubmit} role="search">
      {label ? (
        <label htmlFor={inputId} className="mb-1 block text-xs font-semibold uppercase text-zinc-400">
          {label}
        </label>
      ) : null}
      <div className="flex h-10 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-3 focus-within:border-sky-500">
        <Search className="h-4 w-4 shrink-0 text-zinc-500" />
        <input
          id={inputId}
          aria-label="Buscar na fila"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-600"
          defaultValue={initialQuery}
          key={initialQuery}
          name="q"
          placeholder="Buscar na fila"
        />
        <button
          className="h-7 rounded bg-sky-600 px-2.5 text-xs font-semibold text-white hover:bg-sky-500"
          type="submit"
        >
          Buscar
        </button>
      </div>
    </form>
  );
}
