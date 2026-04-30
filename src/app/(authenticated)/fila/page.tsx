import { Suspense } from "react";
import { connection } from "next/server";
import { OperationalQueue, OperationalQueueSkeleton } from "@/components/operational-queue";

export const unstable_instant = {
  prefetch: "runtime",
  unstable_disableValidation: true,
  samples: [
    { searchParams: { stage: "CUMPRIMENTO", status: "EM ANDAMENTO", q: null, cursor: null } },
    { searchParams: { stage: "QUALIDADE", status: "EM ANDAMENTO", q: null, cursor: null } },
    { searchParams: { view: "dashboard-status", stage: "QUALIDADE", status: "ESTOQUE", q: null, cursor: null } },
  ],
};

export default async function FilaPage({
  searchParams,
}: {
  searchParams: Promise<{
    stage?: string;
    status?: string;
    q?: string;
    cursor?: string;
    responsible?: string;
    view?: string;
  }>;
}) {
  await connection();

  return (
    <>
      <div className="border-b border-zinc-800 px-5 py-4">
        <h1 className="text-xl font-semibold">Fila</h1>
      </div>
      <Suspense fallback={<OperationalQueueSkeleton />}>
        <OperationalQueue searchParams={searchParams} />
      </Suspense>
    </>
  );
}
