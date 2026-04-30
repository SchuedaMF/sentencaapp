import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, FileText } from "lucide-react";
import { EventPanel } from "@/components/event-panel";
import { SalesforceOrdersPanel } from "@/components/salesforce-orders-panel";
import { getEventResponsibleOptions, getSalesforceOrdersForProcess, getSentence, getSentenceEvents } from "@/lib/data";
import { formatDate, statusTone } from "@/lib/normalization";
import type { SentenceStatus } from "@/lib/types";

export const unstable_instant = {
  prefetch: "runtime",
  unstable_disableValidation: true,
  samples: [
    { params: { id: "00000000-0000-0000-0000-000000000000" }, searchParams: { from: null } },
  ],
};

export default async function SentenceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const [{ id }, rawSearchParams] = await Promise.all([params, searchParams]);
  const sentence = await getSentence(id);
  if (!sentence) notFound();

  const eventsPromise = getSentenceEvents(id);
  const responsibleOptionsPromise = getEventResponsibleOptions();
  const salesforceOrdersPromise = getSalesforceOrdersForProcess(sentence.processo);
  const backHref = safeQueueReturnHref(rawSearchParams.from) ?? "/fila?stage=QUALIDADE&status=EM+ANDAMENTO";

  return (
    <>
      <div className="flex items-center gap-3 border-b border-zinc-800 px-5 py-4">
        <Link href={backHref} className="grid h-9 w-9 place-items-center rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800" title="Voltar">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="font-mono text-xl font-semibold">{sentence.processo}</h1>
          <p className="text-sm text-zinc-400">{sentence.autor ?? "Autor nao informado"}</p>
        </div>
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[1fr_420px]">
        <section className="space-y-5">
          <div className="border border-zinc-800 bg-[#1d1e1c] p-5">
            <div className="mb-5 flex flex-wrap gap-3">
              <StageStatusBadge stage="CUMPRIMENTO" status={sentence.cumprimento_status} />
              <StageStatusBadge stage="QUALIDADE" status={sentence.qualidade_status} />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Origem" value={sentence.origem_raw ?? "-"} />
              <Field label="CPF/CNPJ" value={sentence.cpf_cnpj ?? "-"} mono />
              <Field label="UC" value={sentence.uc ?? "-"} mono />
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <Field label="Data ultimo evento" value={formatDate(sentence.data_ultimo_evento)} />
              <Field label="Data cumprimento" value={formatDate(sentence.cumprimento_data)} />
              <Field label="Data qualidade" value={formatDate(sentence.qualidade_data)} />
              <Field label="Responsavel cumprimento" value={sentence.responsavel_cumprimento ?? "-"} />
              <Field label="Responsavel qualidade" value={sentence.responsavel_qualidade ?? "-"} />
              <Field label="Tipo decisao" value={sentence.tipo_decisao_normalized ?? "-"} />
              <Field label="Municipio" value={sentence.municipio_raw ?? "-"} />
            </div>
          </div>

          <div className="border border-zinc-800 bg-[#1d1e1c] p-5">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
              <FileText className="h-5 w-5 text-sky-300" />
              Observacao
            </h2>
            <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-200">{sentence.observacao ?? "-"}</p>
          </div>

          <Suspense fallback={<SalesforceOrdersPanelSkeleton />}>
            <SalesforceOrdersSection salesforceOrdersPromise={salesforceOrdersPromise} />
          </Suspense>
        </section>

        <Suspense fallback={<EventPanelSkeleton />}>
          <EventPanelSection
            eventsPromise={eventsPromise}
            responsibleOptionsPromise={responsibleOptionsPromise}
            sentence={sentence}
          />
        </Suspense>
      </div>
    </>
  );
}

async function SalesforceOrdersSection({
  salesforceOrdersPromise,
}: {
  salesforceOrdersPromise: ReturnType<typeof getSalesforceOrdersForProcess>;
}) {
  const salesforceOrders = await salesforceOrdersPromise;
  return <SalesforceOrdersPanel summary={salesforceOrders} />;
}

async function EventPanelSection({
  sentence,
  eventsPromise,
  responsibleOptionsPromise,
}: {
  sentence: NonNullable<Awaited<ReturnType<typeof getSentence>>>;
  eventsPromise: ReturnType<typeof getSentenceEvents>;
  responsibleOptionsPromise: ReturnType<typeof getEventResponsibleOptions>;
}) {
  const [events, responsibleOptions] = await Promise.all([eventsPromise, responsibleOptionsPromise]);
  return <EventPanel sentence={sentence} events={events} responsibleOptions={responsibleOptions} />;
}

function SalesforceOrdersPanelSkeleton() {
  return (
    <section className="border border-zinc-800 bg-[#1d1e1c] p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="h-7 w-48 animate-pulse rounded bg-zinc-800" />
        <div className="h-7 w-28 animate-pulse rounded bg-zinc-800" />
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="h-[68px] animate-pulse rounded-md border border-zinc-800 bg-zinc-950/40" key={index} />
        ))}
      </div>
      <div className="h-24 animate-pulse rounded-md border border-zinc-800 bg-zinc-950/40" />
    </section>
  );
}

function EventPanelSkeleton() {
  return (
    <aside className="border border-zinc-800 bg-[#1d1e1c] p-5 xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="h-7 w-28 animate-pulse rounded bg-zinc-800" />
        <div className="h-9 w-32 animate-pulse rounded-md bg-zinc-800" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="h-28 animate-pulse border border-zinc-800 bg-zinc-950/30" key={index} />
        ))}
      </div>
    </aside>
  );
}

function StageStatusBadge({ stage, status }: { stage: "CUMPRIMENTO" | "QUALIDADE"; status: SentenceStatus | null | undefined }) {
  return (
    <span className={`inline-flex h-7 items-center gap-2 rounded-md border px-2 text-xs font-semibold ${statusTone(status)}`}>
      <span className="text-[0.65rem] uppercase tracking-[0.18em] opacity-80">{stage}</span>
      <span aria-hidden="true" className="h-3 w-px bg-current/25" />
      <span>{status ?? "SEM STATUS"}</span>
    </span>
  );
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase text-zinc-500">{label}</div>
      <div className={`mt-1 text-sm font-semibold text-zinc-100 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function safeQueueReturnHref(value: string | string[] | undefined) {
  const href = Array.isArray(value) ? value[0] : value;
  if (!href) return null;

  return href === "/fila" || href.startsWith("/fila?") ? href : null;
}
