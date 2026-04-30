import { Filters } from "@/components/filters";
import { SentenceTable } from "@/components/sentence-table";
import { getFilterOptions, getSentences } from "@/lib/data";
import type { WorkflowStage } from "@/lib/types";

type StageSearchParams = {
  q?: string;
  status?: string;
  responsible?: string;
};

export async function StageSentenceList({
  action,
  searchParams,
  stage,
}: {
  action: string;
  searchParams: Promise<StageSearchParams>;
  stage: WorkflowStage;
}) {
  const params = await searchParams;
  const [sentences, filters] = await Promise.all([
    getSentences({ stage, query: params.q, status: params.status, responsible: params.responsible }),
    getFilterOptions(stage),
  ]);

  return (
    <>
      <Filters
        action={action}
        lockedResponsible={filters.lockedResponsible}
        query={params.q}
        responsible={filters.responsible}
        responsibleValue={filters.isManager ? params.responsible : filters.lockedResponsible ?? undefined}
        showResponsibleFilter={filters.isManager}
        status={filters.status}
        statusValue={params.status}
      />
      <div className="p-5">
        <SentenceTable sentences={sentences} stage={stage} />
      </div>
    </>
  );
}

export function StageSentenceListSkeleton() {
  return (
    <>
      <div className="flex flex-wrap items-end gap-3 border-b border-zinc-800 bg-[#1d1e1c] p-4">
        <div className="min-w-[260px] flex-1">
          <div className="mb-2 h-3 w-14 animate-pulse rounded bg-zinc-800" />
          <div className="h-10 animate-pulse rounded-md bg-zinc-900" />
        </div>
        <div className="w-36">
          <div className="mb-2 h-3 w-16 animate-pulse rounded bg-zinc-800" />
          <div className="h-10 animate-pulse rounded-md bg-zinc-900" />
        </div>
        <div className="w-44">
          <div className="mb-2 h-3 w-24 animate-pulse rounded bg-zinc-800" />
          <div className="h-10 animate-pulse rounded-md bg-zinc-900" />
        </div>
        <div className="h-10 w-20 animate-pulse rounded-md bg-sky-950/70" />
      </div>
      <div className="p-5">
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
      </div>
    </>
  );
}
