import { CalendarClock, Mail, UserRound } from "lucide-react";
import { CopyToClipboardButton } from "@/components/copy-to-clipboard-button";
import { EventEditButton, EventPanelClientShell, NewEventButton } from "@/components/event-panel-client";
import { buildEventTitle, buildSentenceEmailHref } from "@/lib/event-email";
import { formatDate } from "@/lib/normalization";
import type { EventResponsibleOption, SentenceEvent, SentenceRecord } from "@/lib/types";

export function EventPanel({
  sentence,
  events,
  responsibleOptions,
  canCreateEvents,
  sticky = true,
}: {
  sentence: SentenceRecord;
  events: SentenceEvent[];
  responsibleOptions: EventResponsibleOption[];
  canCreateEvents: boolean;
  sticky?: boolean;
}) {
  return (
    <EventPanelClientShell sentence={sentence} responsibleOptions={responsibleOptions}>
      <aside className={`border border-zinc-800 bg-[#1d1e1c] p-5 ${sticky ? "xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto" : ""}`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <CalendarClock className="h-5 w-5 text-amber-300" />
            Eventos
          </h2>
          {canCreateEvents ? <NewEventButton /> : null}
        </div>

        <div className="space-y-3">
          {events.map((event) => (
            <EventItem key={event.id} sentence={sentence} event={event} />
          ))}
          {events.length === 0 ? <p className="text-sm text-zinc-400">Sem eventos registrados.</p> : null}
        </div>
      </aside>
    </EventPanelClientShell>
  );
}

function EventItem({ sentence, event }: { sentence: SentenceRecord; event: SentenceEvent }) {
  const eventTitle = buildEventTitle(event.etapa, event.tipo_evento, sentence.tipo_decisao_normalized, sentence.processo);
  const eventDescription = event.obs?.trim() || "-";
  const emailHref = buildSentenceEmailHref(eventTitle, sentence);

  return (
    <div className="group relative border border-zinc-800 transition-colors hover:border-sky-500/40 hover:bg-sky-500/10 focus-within:border-sky-500/40">
      {event.canEdit ? (
        <EventEditButton
          event={event}
          title="Clique para editar este evento"
          label={`Editar evento ${eventTitle} de ${formatDate(event.data_evento)}`}
        />
      ) : null}

      <div className="pointer-events-none relative z-10 p-3">
        <div className="flex min-w-0 items-start gap-2">
          <strong className="min-w-0 flex-1 break-words text-sm leading-5 text-zinc-100">{eventTitle}</strong>
          <div className="pointer-events-auto">
            <CopyToClipboardButton
              text={eventTitle}
              title="Copiar titulo do evento"
              ariaLabel={`Copiar titulo do evento: ${eventTitle}`}
            />
          </div>
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
