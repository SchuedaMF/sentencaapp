"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Send, Trash2, X } from "lucide-react";
import { deleteEventAction, saveEventAction } from "@/app/actions";
import {
  canonicalizeEventPendencia,
  eventAreaOptions,
  eventAreaOtherValue,
  eventPendingOptions,
  getEventAreaSelectDefaults,
} from "@/lib/event-taxonomy";
import type { EventResponsibleOption, SentenceEvent, SentenceRecord } from "@/lib/types";

const noResponsibleValue = "__none__";
const preserveResponsibleValue = "__current__";

export function EventForm({
  sentence,
  event,
  responsibleOptions,
  onCancel,
  onSuccess,
}: {
  sentence: SentenceRecord;
  event?: SentenceEvent | null;
  responsibleOptions: EventResponsibleOption[];
  onCancel?: () => void;
  onSuccess?: () => void;
}) {
  const [saveState, saveAction, savePending] = useActionState(saveEventAction, null);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteEventAction.bind(null, event?.id ?? ""), null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const isEditing = Boolean(event);
  const eventTitle = event ? buildEventTitle(sentence, event) : null;
  const defaults = getDefaultValues(sentence, responsibleOptions, event);
  const [tipoEvento, setTipoEvento] = useState(defaults.tipoEvento);
  const [areaSelectValue, setAreaSelectValue] = useState(defaults.areaSelectValue);
  const isPendingEvent = tipoEvento === "PENDENTE";
  const showAreaCustom = areaSelectValue === eventAreaOtherValue;
  const message = deleteState?.message ?? saveState?.message;
  const messageIsPositive = deleteState?.message ? deleteState.ok : saveState?.ok;

  useEffect(() => {
    if (saveState?.ok || deleteState?.ok) onSuccess?.();
  }, [onSuccess, saveState?.ok, deleteState?.ok]);

  function openDatePicker() {
    const input = dateInputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!input?.showPicker) return;

    try {
      input.showPicker();
    } catch {
      // Some browsers only allow showPicker from specific trusted events.
    }
  }

  return (
    <form action={saveAction} className="space-y-4 p-5">
      <input type="hidden" name="sentenceId" value={sentence.id} />
      <input type="hidden" name="eventId" value={event?.id ?? ""} />

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="event-form-title" className="text-lg font-semibold">
            {isEditing ? "Editar evento" : "Novo evento"}
          </h2>
          {eventTitle ? <p className="mt-1 break-words text-sm font-semibold text-zinc-300">{eventTitle}</p> : null}
        </div>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            title="Fechar"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Etapa</span>
          <select name="etapa" required defaultValue={defaults.etapa} className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm">
            <option value="CUMPRIMENTO">CUMPRIMENTO</option>
            <option value="QUALIDADE">QUALIDADE</option>
          </select>
        </label>

        <label>
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Tipo evento</span>
          <select
            name="tipoEvento"
            required
            value={tipoEvento}
            onChange={(event) => setTipoEvento(event.target.value as typeof tipoEvento)}
            className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm"
          >
            <option value="PENDENTE">PENDENTE</option>
            <option value="ENTREGUE">ENTREGUE</option>
          </select>
        </label>

        <label>
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Data evento</span>
          <input
            ref={dateInputRef}
            name="dataEvento"
            type="date"
            required
            defaultValue={defaults.dataEvento}
            onClick={openDatePicker}
            style={{ colorScheme: "dark" }}
            className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm"
          />
        </label>

        <label>
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Responsável</span>
          <select
            name="responsavelProfileId"
            defaultValue={defaults.responsavelProfileId}
            className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm"
          >
            <option value={noResponsibleValue}>Sem responsável</option>
            {defaults.legacyResponsible ? (
              <option value={preserveResponsibleValue}>Atual - {defaults.legacyResponsible}</option>
            ) : null}
            {responsibleOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.displayName}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Pendência</span>
          <select
            name="pendencia"
            required={isPendingEvent}
            aria-required={isPendingEvent}
            defaultValue={defaults.pendencia}
            className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm"
          >
            <option value="">Sem pendência</option>
            {eventPendingOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <div className="space-y-2">
          <label>
            <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Área</span>
            <select
              name="area"
              value={areaSelectValue}
              onChange={(event) => setAreaSelectValue(event.target.value)}
              className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm"
            >
              <option value="">Sem área</option>
              {eventAreaOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={eventAreaOtherValue}>Outro</option>
            </select>
          </label>

          {showAreaCustom ? (
            <input
              name="areaCustom"
              required
              defaultValue={defaults.areaCustom}
              placeholder="Informe a área"
              className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm"
            />
          ) : null}
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Observação</span>
        <textarea name="obs" rows={4} defaultValue={defaults.obs} className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" />
      </label>

      {message ? <div className={`text-sm ${messageIsPositive ? "text-emerald-300" : "text-red-300"}`}>{message}</div> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={savePending || deletePending}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
        >
          <Send className="h-4 w-4" />
          {savePending ? "Salvando..." : isEditing ? "Salvar alterações" : "Salvar evento"}
        </button>

        {isEditing ? (
          <button
            type="submit"
            formAction={deleteAction}
            formNoValidate
            onClick={(event) => {
              if (!window.confirm("Excluir este evento?")) event.preventDefault();
            }}
            disabled={savePending || deletePending}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-red-500/40 px-4 text-sm font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-60"
            title="Excluir evento"
          >
            <Trash2 className="h-4 w-4" />
            {deletePending ? "Excluindo..." : "Excluir evento"}
          </button>
        ) : null}

        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-10 items-center rounded-md border border-zinc-700 px-4 text-sm font-semibold text-zinc-200 hover:bg-zinc-800"
          >
            Cancelar
          </button>
        ) : null}
      </div>
    </form>
  );
}

function getDefaultValues(
  sentence: SentenceRecord,
  responsibleOptions: EventResponsibleOption[],
  event?: SentenceEvent | null,
) {
  if (event) {
    const matchedResponsibleId = findResponsibleOptionId(event.responsavel, responsibleOptions);
    const legacyResponsible = matchedResponsibleId ? null : event.responsavel?.trim() || null;
    const areaDefaults = getEventAreaSelectDefaults(event.area);

    return {
      etapa: event.etapa,
      tipoEvento: event.tipo_evento,
      dataEvento: event.data_evento,
      responsavelProfileId: matchedResponsibleId ?? (legacyResponsible ? preserveResponsibleValue : noResponsibleValue),
      legacyResponsible,
      pendencia: canonicalizeEventPendencia(event.pendencia) ?? "",
      areaSelectValue: areaDefaults.selectValue,
      areaCustom: areaDefaults.customValue,
      obs: event.obs ?? "",
    };
  }

  const defaultResponsibleId = findResponsibleOptionId(sentence.responsavel_cumprimento, responsibleOptions);

  return {
    etapa: "CUMPRIMENTO" as const,
    tipoEvento: "PENDENTE" as const,
    dataEvento: todayInputValue(),
    responsavelProfileId: defaultResponsibleId ?? noResponsibleValue,
    legacyResponsible: null,
    pendencia: "",
    areaSelectValue: "",
    areaCustom: "",
    obs: "",
  };
}

function buildEventTitle(sentence: SentenceRecord, event: SentenceEvent) {
  return [event.etapa, event.tipo_evento, sentence.tipo_decisao_normalized ?? "-", sentence.processo].join(" - ");
}

function findResponsibleOptionId(value: string | null | undefined, options: EventResponsibleOption[]) {
  const normalizedValue = normalizeResponsibleName(value);
  if (!normalizedValue) return null;

  return options.find((option) => normalizeResponsibleName(option.displayName) === normalizedValue)?.id ?? null;
}

function normalizeResponsibleName(value: string | null | undefined) {
  return value?.trim().toLocaleUpperCase("pt-BR") ?? "";
}

function todayInputValue() {
  const today = new Date();
  const offset = today.getTimezoneOffset() * 60000;
  return new Date(today.getTime() - offset).toISOString().slice(0, 10);
}
