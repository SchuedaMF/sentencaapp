import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CheckCircle2, ClipboardList, GitCompareArrows } from "lucide-react";
import { formatDate, statusTone } from "@/lib/normalization";
import type { SentenceProcessDuplicate, SentenceRecord, SentenceStatus } from "@/lib/types";

export function ProcessDuplicatesPanel({
  currentSentence,
  duplicates,
  returnHref,
}: {
  currentSentence: SentenceRecord;
  duplicates: SentenceProcessDuplicate[];
  returnHref?: string;
}) {
  const current = duplicates.find((row) => row.id === currentSentence.id || row.is_current);
  const related = duplicates.filter((row) => row.id !== currentSentence.id);
  if (related.length === 0) return null;

  const distinctObservationCount = countDistinctObservations(duplicates);
  const orderSummary = current ?? related[0];

  return (
    <section className="border border-amber-500/25 bg-[#1d1e1c] p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <GitCompareArrows className="h-5 w-5 text-amber-300" />
            Registros do mesmo processo
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            {duplicates.length} registros encontrados para este processo.
            {distinctObservationCount > 1 ? ` ${distinctObservationCount} variacoes de observacao.` : " Observacoes equivalentes."}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-100">
          <AlertTriangle className="h-3.5 w-3.5" />
          Duplicidade por processo
        </div>
      </div>

      {orderSummary && Number(orderSummary.order_total ?? 0) > 0 ? (
        <div className="mb-4 flex flex-wrap gap-2 text-xs font-semibold text-zinc-300">
          <SummaryPill icon={<ClipboardList className="h-3.5 w-3.5" />} label={`${orderSummary.order_total} ordens SF`} />
          <SummaryPill label={`${orderSummary.order_open} abertas`} tone="text-amber-200" />
          <SummaryPill label={`${orderSummary.order_closed} fechadas`} tone="text-emerald-200" />
          {Number(orderSummary.order_unknown ?? 0) > 0 ? <SummaryPill label={`${orderSummary.order_unknown} sem status`} /> : null}
        </div>
      ) : null}

      <div className="space-y-3">
        {related.map((sentence) => (
          <RelatedSentenceCard
            currentSentence={currentSentence}
            key={sentence.id}
            returnHref={returnHref}
            sentence={sentence}
          />
        ))}
      </div>
    </section>
  );
}

function RelatedSentenceCard({
  currentSentence,
  returnHref,
  sentence,
}: {
  currentSentence: SentenceRecord;
  returnHref?: string;
  sentence: SentenceProcessDuplicate;
}) {
  const comparison = compareObservations(currentSentence.observacao, sentence.observacao);
  const operationalFields = buildOperationalFields(sentence);

  return (
    <article className="rounded-md border border-zinc-800 bg-zinc-950/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-all font-mono text-sm font-semibold text-zinc-50">{sentence.processo}</span>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs font-semibold text-zinc-300">
              {Number(sentence.event_count ?? 0)} eventos
            </span>
          </div>
        </div>
        <Link
          className="relative inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-zinc-700 px-2 text-xs font-semibold text-sky-100 transition-colors hover:border-sky-500/60 hover:bg-sky-500/15"
          href={sentenceHref(sentence.id, returnHref)}
          prefetch={false}
          title="Abrir registro relacionado"
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
          Abrir
        </Link>
      </div>

      <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
        {operationalFields.map((field) => (
          <Info
            key={field.label}
            label={field.label}
            value={field.value}
          />
        ))}
      </div>

      <ObservationComparison comparison={comparison} />
    </article>
  );
}

function ObservationComparison({ comparison }: { comparison: ObservationComparisonResult }) {
  if (comparison.same) {
    return (
      <div className="mt-4 inline-flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-200">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Observacao igual
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-amber-100">
        <AlertTriangle className="h-3.5 w-3.5" />
        Observacao diferente
        <span className="text-zinc-400">
          Atual {comparison.currentLength} caracteres / esta {comparison.relatedLength} caracteres
        </span>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-zinc-200">{comparison.relatedObservation || "-"}</p>
    </div>
  );
}

function SummaryPill({ icon, label, tone = "text-zinc-300" }: { icon?: React.ReactNode; label: string; tone?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950/40 px-2 py-1 ${tone}`}>
      {icon}
      {label}
    </span>
  );
}

function StageStatusBadge({ stage, status }: { stage: "CUMPRIMENTO" | "QUALIDADE"; status: SentenceStatus | null | undefined }) {
  return (
    <span className={`inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-semibold ${statusTone(status)}`}>
      <span className="text-[0.62rem] uppercase opacity-80">{stage}</span>
      <span aria-hidden="true" className="h-3 w-px bg-current/25" />
      <span>{status ?? "SEM STATUS"}</span>
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

type ObservationComparisonResult = {
  same: boolean;
  currentLength: number;
  relatedLength: number;
  relatedObservation: string;
};

function compareObservations(current: string | null | undefined, related: string | null | undefined): ObservationComparisonResult {
  const normalizedCurrent = normalizeObservation(current);
  const normalizedRelated = normalizeObservation(related);

  return {
    same: normalizedCurrent === normalizedRelated,
    currentLength: (current ?? "").trim().length,
    relatedLength: (related ?? "").trim().length,
    relatedObservation: (related ?? "").trim(),
  };
}

function countDistinctObservations(rows: SentenceProcessDuplicate[]) {
  return new Set(rows.map((row) => normalizeObservation(row.observacao))).size;
}

function normalizeObservation(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function sentenceHref(id: string, returnHref: string | undefined) {
  if (!returnHref) return `/sentencas/${id}`;

  const params = new URLSearchParams({ from: returnHref });
  return `/sentencas/${id}?${params.toString()}`;
}

type DifferenceItem = {
  label: string;
  value: React.ReactNode;
};

function buildOperationalFields(sentence: SentenceProcessDuplicate): DifferenceItem[] {
  return [
    { label: "Status cumprimento", value: <StageStatusBadge stage="CUMPRIMENTO" status={sentence.cumprimento_status} /> },
    { label: "Responsavel cumprimento", value: sentence.responsavel_cumprimento?.trim() || "-" },
    { label: "Data cumprimento", value: formatDate(sentence.cumprimento_data) },
    { label: "Status qualidade", value: <StageStatusBadge stage="QUALIDADE" status={sentence.qualidade_status} /> },
    { label: "Responsavel qualidade", value: sentence.responsavel_qualidade?.trim() || "-" },
    { label: "Data qualidade", value: formatDate(sentence.qualidade_data) },
  ];
}
