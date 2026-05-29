"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import type { EventResponsibleOption, SentenceEvent, SentenceRecord } from "@/lib/types";

const EventForm = dynamic(
  () => import("@/components/event-form").then((mod) => mod.EventForm),
  {
    loading: () => <div className="p-6 text-sm text-zinc-400">Carregando...</div>,
  },
);

type EventPanelContextValue = {
  closeForm: () => void;
  handleSuccess: () => void;
  isFormOpen: boolean;
  openCreateForm: () => void;
  openEditForm: (event: SentenceEvent) => void;
  responsibleOptions: EventResponsibleOption[];
  selectedEvent: SentenceEvent | null;
  sentence: SentenceRecord;
};

const EventPanelContext = createContext<EventPanelContextValue | null>(null);

export function EventPanelClientShell({
  children,
  responsibleOptions,
  sentence,
}: {
  children: ReactNode;
  responsibleOptions: EventResponsibleOption[];
  sentence: SentenceRecord;
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
    <EventPanelContext.Provider
      value={{
        closeForm,
        handleSuccess,
        isFormOpen,
        openCreateForm,
        openEditForm,
        responsibleOptions,
        selectedEvent,
        sentence,
      }}
    >
      {children}
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
    </EventPanelContext.Provider>
  );
}

export function NewEventButton() {
  const { openCreateForm } = useEventPanelContext();

  return (
    <button
      type="button"
      onClick={openCreateForm}
      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-sky-600 px-3 text-sm font-semibold text-white hover:bg-sky-500"
      title="Novo evento"
    >
      <Plus className="h-4 w-4" />
      Novo evento
    </button>
  );
}

export function EventEditButton({ event, label, title }: { event: SentenceEvent; label: string; title: string }) {
  const { openEditForm } = useEventPanelContext();

  return (
    <button
      type="button"
      onClick={() => openEditForm(event)}
      className="absolute inset-0 z-0 w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
      title={title}
      aria-label={label}
    />
  );
}

function useEventPanelContext() {
  const context = useContext(EventPanelContext);
  if (!context) throw new Error("Event panel controls must be rendered inside EventPanelClientShell.");
  return context;
}
