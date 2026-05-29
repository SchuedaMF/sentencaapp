import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, FileText, Mail, X } from "lucide-react";
import { CopyToClipboardButton } from "@/components/copy-to-clipboard-button";
import { EventPanel } from "@/components/event-panel";
import { ProcessDuplicatesPanel } from "@/components/process-duplicates-panel";
import { SalesforceOrdersPanel } from "@/components/salesforce-orders-panel";
import { getCurrentProfile, getEventResponsibleOptions, getSalesforceOrdersForProcess, getSentence, getSentenceEvents, getSentenceProcessDuplicates } from "@/lib/data";
import { buildEventTitle, buildSentenceEmailHref } from "@/lib/event-email";
import { formatDate, statusTone } from "@/lib/normalization";
import { canCreateOwnEvents } from "@/lib/permissions";
import type { SentenceStatus, WorkflowStage } from "@/lib/types";

type SentenceDetailVariant = "page" | "drawer";

type SentenceDetailViewProps = {
  sentenceId: string;
  activeStage?: WorkflowStage;
  variant?: SentenceDetailVariant;
  backHref?: string;
  closeHref?: string;
  returnHref?: string;
  missingFallback?: ReactNode;
};

export async function SentenceDetailView({
  sentenceId,
  activeStage,
  variant = "page",
  backHref,
  closeHref,
  returnHref,
  missingFallback,
}: SentenceDetailViewProps) {
  const sentence = await getSentence(sentenceId);
  if (!sentence) {
    if (variant === "page") notFound();
    return missingFallback ?? null;
  }

  const eventsPromise = getSentenceEvents(sentenceId);
  const responsibleOptionsPromise = getEventResponsibleOptions();
  const salesforceOrdersPromise = getSalesforceOrdersForProcess(sentence.processo);
  const processDuplicatesPromise = getSentenceProcessDuplicates(sentenceId);
  const pageBackHref = backHref ?? "/fila?stage=QUALIDADE&status=EM+ANDAMENTO";
  const duplicateReturnHref = variant === "drawer" ? returnHref : pageBackHref;
  const headerStage = activeStage ?? queueStageFromHref(variant === "drawer" ? returnHref : pageBackHref) ?? "QUALIDADE";
  const headerTitle = buildEventTitle(headerStage, "ENTREGUE", sentence.tipo_decisao_normalized, sentence.processo);
  const headerEmailHref = buildSentenceEmailHref(headerTitle, sentence);

  if (variant === "drawer") {
    return (
      <>
        <SentenceDrawerHeader
          closeHref={closeHref ?? "/fila?stage=CUMPRIMENTO&status=EM+ANDAMENTO"}
          emailHref={headerEmailHref}
          fullPageHref={sentencePageHref(sentence.id, returnHref)}
          sentence={sentence}
          title={headerTitle}
        />
        <SentenceDetailBody
          processDuplicatesPromise={processDuplicatesPromise}
          duplicateReturnHref={duplicateReturnHref}
          eventsPromise={eventsPromise}
          responsibleOptionsPromise={responsibleOptionsPromise}
          salesforceOrdersPromise={salesforceOrdersPromise}
          sentence={sentence}
          variant="drawer"
        />
      </>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 border-b border-zinc-800 px-5 py-4">
        <Link href={pageBackHref} className="grid h-9 w-9 place-items-center rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800" title="Voltar">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="break-all font-mono text-base font-semibold leading-6">{headerTitle}</h1>
          <p className="truncate text-sm text-zinc-400">{sentence.autor ?? "Autor nao informado"}</p>
        </div>
        <a
          aria-label={`Criar e-mail no Outlook para o caso: ${headerTitle}`}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-zinc-700 text-amber-200 hover:bg-amber-500/10"
          href={headerEmailHref}
          title="Criar e-mail no Outlook"
        >
          <Mail className="h-4 w-4" />
        </a>
      </div>

      <SentenceDetailBody
        processDuplicatesPromise={processDuplicatesPromise}
        duplicateReturnHref={duplicateReturnHref}
        eventsPromise={eventsPromise}
        responsibleOptionsPromise={responsibleOptionsPromise}
        salesforceOrdersPromise={salesforceOrdersPromise}
        sentence={sentence}
        variant="page"
      />
    </>
  );
}

function SentenceDrawerHeader({
  closeHref,
  emailHref,
  fullPageHref,
  sentence,
  title,
}: {
  closeHref: string;
  emailHref: string;
  fullPageHref: string;
  sentence: NonNullable<Awaited<ReturnType<typeof getSentence>>>;
  title: string;
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-800 bg-[#20211f] px-4 py-3">
      <div className="min-w-0 flex-1">
        <h2 className="break-all font-mono text-sm font-semibold leading-5 text-zinc-50">{title}</h2>
        <p className="truncate text-sm text-zinc-400">{sentence.autor ?? "Autor nao informado"}</p>
      </div>
      <a
        aria-label={`Criar e-mail no Outlook para o caso: ${title}`}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-zinc-700 text-amber-200 hover:bg-amber-500/10"
        href={emailHref}
        title="Criar e-mail no Outlook"
      >
        <Mail className="h-4 w-4" />
      </a>
      <Link
        aria-label={`Abrir pagina do caso ${sentence.processo}`}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-zinc-700 text-sky-200 hover:bg-sky-500/10"
        href={fullPageHref}
        prefetch={false}
        title="Abrir pagina"
      >
        <ArrowUpRight className="h-4 w-4" />
      </Link>
      <Link
        aria-label="Fechar caso"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
        href={closeHref}
        scroll={false}
        title="Fechar"
      >
        <X className="h-4 w-4" />
      </Link>
    </div>
  );
}

function SentenceDetailBody({
  duplicateReturnHref,
  eventsPromise,
  processDuplicatesPromise,
  responsibleOptionsPromise,
  salesforceOrdersPromise,
  sentence,
  variant,
}: {
  duplicateReturnHref?: string;
  eventsPromise: ReturnType<typeof getSentenceEvents>;
  processDuplicatesPromise: ReturnType<typeof getSentenceProcessDuplicates>;
  responsibleOptionsPromise: ReturnType<typeof getEventResponsibleOptions>;
  salesforceOrdersPromise: ReturnType<typeof getSalesforceOrdersForProcess>;
  sentence: NonNullable<Awaited<ReturnType<typeof getSentence>>>;
  variant: SentenceDetailVariant;
}) {
  const compact = variant === "drawer";
  const overview = <SentenceOverview compact={compact} sentence={sentence} />;
  const observation = <SentenceObservation sentence={sentence} />;
  const duplicates = (
    <Suspense fallback={<ProcessDuplicatesPanelSkeleton />}>
      <ProcessDuplicatesSection
        compact={compact}
        currentSentence={sentence}
        processDuplicatesPromise={processDuplicatesPromise}
        queueCaseBaseHref={variant === "drawer" ? duplicateReturnHref : undefined}
        returnHref={duplicateReturnHref}
      />
    </Suspense>
  );
  const salesforce = (
    <Suspense fallback={<SalesforceOrdersPanelSkeleton />}>
      <SalesforceOrdersSection salesforceOrdersPromise={salesforceOrdersPromise} />
    </Suspense>
  );
  const events = (
    <Suspense fallback={<EventPanelSkeleton sticky={!compact} />}>
      <EventPanelSection
        eventsPromise={eventsPromise}
        responsibleOptionsPromise={responsibleOptionsPromise}
        sentence={sentence}
        sticky={!compact}
      />
    </Suspense>
  );

  if (variant === "drawer") {
    return (
      <div className="space-y-5 p-4">
        {overview}
        {observation}
        {events}
        {duplicates}
        {salesforce}
      </div>
    );
  }

  return (
    <div className="grid gap-5 p-5 xl:grid-cols-[1fr_420px]">
      <section className="space-y-5">
        {overview}
        {observation}
        {duplicates}
        {salesforce}
      </section>
      {events}
    </div>
  );
}

function SentenceOverview({
  compact,
  sentence,
}: {
  compact: boolean;
  sentence: NonNullable<Awaited<ReturnType<typeof getSentence>>>;
}) {
  const gridClassName = compact ? "grid gap-4 sm:grid-cols-2" : "grid gap-4 md:grid-cols-3";

  return (
    <div className="border border-zinc-800 bg-[#1d1e1c] p-5">
      <div className="mb-5 flex flex-wrap gap-3">
        <StageStatusBadge stage="CUMPRIMENTO" status={sentence.cumprimento_status} />
        <StageStatusBadge stage="QUALIDADE" status={sentence.qualidade_status} />
      </div>

      <div className={gridClassName}>
        <Field label="Origem" value={sentence.origem_raw ?? "-"} />
        <Field label="CPF/CNPJ" value={sentence.cpf_cnpj ?? "-"} mono />
        <Field label="UC" value={sentence.uc ?? "-"} mono />
      </div>

      <div className={`mt-4 ${gridClassName}`}>
        <Field label="Data ultimo evento" value={formatDate(sentence.data_ultimo_evento)} />
        <Field label="Pendencia" value={sentence.pendencia ?? "-"} />
        <Field label="Data cumprimento" value={formatDate(sentence.cumprimento_data)} />
        <Field label="Data qualidade" value={formatDate(sentence.qualidade_data)} />
        <Field label="Responsavel cumprimento" value={sentence.responsavel_cumprimento ?? "-"} />
        <Field label="Responsavel qualidade" value={sentence.responsavel_qualidade ?? "-"} />
        <Field label="Tipo decisao" value={sentence.tipo_decisao_normalized ?? "-"} />
        <Field label="Municipio" value={sentence.municipio_raw ?? "-"} />
      </div>
    </div>
  );
}

function SentenceObservation({ sentence }: { sentence: NonNullable<Awaited<ReturnType<typeof getSentence>>> }) {
  const observationText = sentence.observacao ?? "";
  const hasObservation = observationText.trim().length > 0;

  return (
    <div className="border border-zinc-800 bg-[#1d1e1c] p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold">
          <FileText className="h-5 w-5 shrink-0 text-sky-300" />
          Observacao
        </h2>
        <CopyToClipboardButton
          text={observationText}
          title="Copiar conteudo da obrigacao"
          ariaLabel="Copiar conteudo da obrigacao"
          disabled={!hasObservation}
        />
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-zinc-200">{hasObservation ? observationText : "-"}</p>
    </div>
  );
}

async function ProcessDuplicatesSection({
  compact,
  currentSentence,
  processDuplicatesPromise,
  queueCaseBaseHref,
  returnHref,
}: {
  compact: boolean;
  currentSentence: NonNullable<Awaited<ReturnType<typeof getSentence>>>;
  processDuplicatesPromise: ReturnType<typeof getSentenceProcessDuplicates>;
  queueCaseBaseHref?: string;
  returnHref?: string;
}) {
  const processDuplicates = await processDuplicatesPromise;
  return (
    <ProcessDuplicatesPanel
      compact={compact}
      currentSentence={currentSentence}
      duplicates={processDuplicates}
      queueCaseBaseHref={queueCaseBaseHref}
      returnHref={returnHref}
    />
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
  sticky,
}: {
  sentence: NonNullable<Awaited<ReturnType<typeof getSentence>>>;
  eventsPromise: ReturnType<typeof getSentenceEvents>;
  responsibleOptionsPromise: ReturnType<typeof getEventResponsibleOptions>;
  sticky: boolean;
}) {
  const [events, responsibleOptions] = await Promise.all([eventsPromise, responsibleOptionsPromise]);
  const profile = await getCurrentProfile();
  return <EventPanel canCreateEvents={canCreateOwnEvents(profile)} sentence={sentence} events={events} responsibleOptions={responsibleOptions} sticky={sticky} />;
}

export function ProcessDuplicatesPanelSkeleton() {
  return (
    <section className="border border-zinc-800 bg-[#1d1e1c] p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="h-7 w-64 max-w-full animate-pulse rounded bg-zinc-800" />
          <div className="mt-2 h-4 w-80 max-w-full animate-pulse rounded bg-zinc-800" />
        </div>
        <div className="h-7 w-32 animate-pulse rounded bg-zinc-800" />
      </div>
      <div className="h-28 animate-pulse rounded-md border border-zinc-800 bg-zinc-950/40" />
    </section>
  );
}

export function SalesforceOrdersPanelSkeleton() {
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

export function EventPanelSkeleton({ sticky = true }: { sticky?: boolean }) {
  return (
    <aside className={`border border-zinc-800 bg-[#1d1e1c] p-5 ${sticky ? "xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)]" : ""}`}>
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

function Field({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase text-zinc-500">{label}</div>
      <div className={`mt-1 break-words text-sm font-semibold text-zinc-100 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function sentencePageHref(id: string, returnHref: string | undefined) {
  if (!returnHref) return `/sentencas/${id}`;

  const params = new URLSearchParams({ from: returnHref });
  return `/sentencas/${id}?${params.toString()}`;
}

function queueStageFromHref(href: string | undefined): WorkflowStage | undefined {
  if (!href || (href !== "/fila" && !href.startsWith("/fila?"))) return undefined;

  const [, search = ""] = href.split("?");
  const stage = new URLSearchParams(search).get("stage");
  return stage === "CUMPRIMENTO" || stage === "QUALIDADE" ? stage : undefined;
}
