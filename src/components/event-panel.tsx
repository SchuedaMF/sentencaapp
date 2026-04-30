"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, Copy, Mail, Plus, UserRound } from "lucide-react";
import { EventForm } from "@/components/event-form";
import { formatDate } from "@/lib/normalization";
import type { EventResponsibleOption, SentenceEvent, SentenceRecord } from "@/lib/types";

type CopyStatus = "idle" | "copied" | "error";
const EMAIL_RECIPIENT = "CumprimentodeDecisoesJudiciais_Ampla@enel.com";

export function EventPanel({
  sentence,
  events,
  responsibleOptions,
}: {
  sentence: SentenceRecord;
  events: SentenceEvent[];
  responsibleOptions: EventResponsibleOption[];
}) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<SentenceEvent | null>(null);
  const router = useRouter();

  function openCreateForm() {
    setSelectedEvent(null);
    setIsFormOpen(true);
  }

  function openEditForm(event: SentenceEvent) {
    setSelectedEvent(event);
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setSelectedEvent(null);
  }

  function handleSuccess() {
    closeForm();
    router.refresh();
  }

  return (
    <>
      <aside className="border border-zinc-800 bg-[#1d1e1c] p-5 xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <CalendarClock className="h-5 w-5 text-amber-300" />
            Eventos
          </h2>
          <button
            type="button"
            onClick={openCreateForm}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-sky-600 px-3 text-sm font-semibold text-white hover:bg-sky-500"
            title="Novo evento"
          >
            <Plus className="h-4 w-4" />
            Novo evento
          </button>
        </div>

        <div className="space-y-3">
          {events.map((event) => (
            <EventItem key={event.id} sentence={sentence} event={event} onClick={() => openEditForm(event)} />
          ))}
          {events.length === 0 ? <p className="text-sm text-zinc-400">Sem eventos registrados.</p> : null}
        </div>
      </aside>

      {isFormOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 py-8 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="event-form-title"
          onClick={closeForm}
        >
          <div
            className="max-h-[calc(100vh-4rem)] w-full max-w-3xl overflow-y-auto border border-zinc-700 bg-[#1d1e1c] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <EventForm
              key={selectedEvent?.id ?? "new"}
              sentence={sentence}
              event={selectedEvent}
              responsibleOptions={responsibleOptions}
              onCancel={closeForm}
              onSuccess={handleSuccess}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

function EventItem({ sentence, event, onClick }: { sentence: SentenceRecord; event: SentenceEvent; onClick: () => void }) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const resetCopyStatusTimeoutRef = useRef<number | null>(null);
  const eventTitle = [event.etapa, event.tipo_evento, sentence.tipo_decisao_normalized ?? "-", sentence.processo].join(" - ");
  const eventDescription = event.obs?.trim() || "-";
  const emailBody = [
    "Prezados,",
    "",
    `UC: ${sentence.uc?.trim() || "-"}`,
    "",
    "Segue obrigação de fazer que deve ser cumprida:",
    sentence.observacao?.trim() || "-",
  ].join("\n");
  const emailHref = `mailto:${EMAIL_RECIPIENT}?subject=${encodeURIComponent(eventTitle)}&body=${encodeURIComponent(emailBody)}`;
  const copyFeedbackText =
    copyStatus === "copied" ? "Copiado" : copyStatus === "error" ? "Não foi possível copiar" : "";

  useEffect(() => {
    return () => {
      if (resetCopyStatusTimeoutRef.current) window.clearTimeout(resetCopyStatusTimeoutRef.current);
    };
  }, []);

  async function handleCopyTitle() {
    if (!navigator.clipboard) {
      showCopyStatus("error");
      return;
    }

    try {
      await navigator.clipboard.writeText(eventTitle);
      showCopyStatus("copied");
    } catch {
      showCopyStatus("error");
    }
  }

  function showCopyStatus(status: Exclude<CopyStatus, "idle">) {
    if (resetCopyStatusTimeoutRef.current) window.clearTimeout(resetCopyStatusTimeoutRef.current);

    setCopyStatus(status);
    resetCopyStatusTimeoutRef.current = window.setTimeout(() => {
      setCopyStatus("idle");
      resetCopyStatusTimeoutRef.current = null;
    }, 1800);
  }

  return (
    <div className="group relative border border-zinc-800 transition-colors hover:border-sky-500/40 hover:bg-sky-500/10 focus-within:border-sky-500/40">
      <button
        type="button"
        onClick={onClick}
        className="absolute inset-0 z-0 w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
        title="Clique para editar este evento"
        aria-label={`Editar evento ${eventTitle} de ${formatDate(event.data_evento)}`}
      />

      <div className="pointer-events-none relative z-10 p-3">
        <div className="flex min-w-0 items-start gap-2">
          <strong className="min-w-0 flex-1 break-words text-sm leading-5 text-zinc-100">{eventTitle}</strong>
          <span
            aria-live="polite"
            className={`shrink-0 text-xs font-semibold ${
              copyStatus === "copied" ? "text-emerald-300" : copyStatus === "error" ? "text-red-300" : "sr-only"
            }`}
          >
            {copyFeedbackText}
          </span>
          <button
            type="button"
            onClick={handleCopyTitle}
            className="pointer-events-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-700 bg-zinc-950/80 text-zinc-300 transition-colors hover:border-sky-500/50 hover:text-sky-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
            title="Copiar título do evento"
            aria-label={`Copiar título do evento: ${eventTitle}`}
          >
            {copyStatus === "copied" ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
          </button>
          <a
            href={emailHref}
            className="pointer-events-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-700 bg-zinc-950/80 text-zinc-300 transition-colors hover:border-amber-500/50 hover:text-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"
            title="Criar e-mail no Outlook"
            aria-label={`Criar e-mail no Outlook para o evento: ${eventTitle}`}
          >
            <Mail className="h-4 w-4" />
          </a>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-zinc-400">
          <span className="inline-flex min-w-0 items-center gap-2">
            <UserRound className="h-4 w-4 text-zinc-500" />
            <span className="truncate">{event.responsavel ?? "-"}</span>
          </span>
          <span className="h-4 w-px bg-zinc-700" aria-hidden="true" />
          <span className="inline-flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-zinc-500" />
            {formatDate(event.data_evento)}
          </span>
        </div>

        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-300">{eventDescription}</p>
      </div>
    </div>
  );
}
