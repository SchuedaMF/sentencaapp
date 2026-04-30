import { differenceInCalendarDays, isValid, parseISO } from "date-fns";
import type { SentenceRecord, SentenceStatus, WorkflowStage } from "@/lib/types";

export const statusLabels: SentenceStatus[] = ["ENTREGUE", "PENDENTE", "EM ANDAMENTO", "ESTOQUE"];

export function statusTone(status: SentenceStatus | null | undefined) {
  switch (status) {
    case "ENTREGUE":
      return "border-emerald-500/35 bg-emerald-500/12 text-emerald-200";
    case "PENDENTE":
      return "border-red-500/35 bg-red-500/12 text-red-200";
    case "EM ANDAMENTO":
      return "border-amber-500/35 bg-amber-500/12 text-amber-200";
    case "ESTOQUE":
      return "border-sky-500/35 bg-sky-500/12 text-sky-200";
    default:
      return "border-zinc-600 bg-zinc-800 text-zinc-300";
  }
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return "-";
  return `${day}/${month}/${year}`;
}

export function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export function currentStageStatus(sentence: SentenceRecord, stage: WorkflowStage) {
  return stage === "CUMPRIMENTO" ? sentence.cumprimento_status : sentence.qualidade_status;
}

export function currentStageResponsible(sentence: SentenceRecord, stage: WorkflowStage) {
  return stage === "CUMPRIMENTO" ? sentence.responsavel_cumprimento : sentence.responsavel_qualidade;
}

export function currentStageDate(sentence: SentenceRecord, stage: WorkflowStage) {
  return stage === "CUMPRIMENTO" ? sentence.cumprimento_data : sentence.qualidade_data;
}

export function queueSlaDays(sentence: SentenceRecord, stage: WorkflowStage) {
  const startValue = stage === "CUMPRIMENTO" ? sentence.envio_bcc : sentence.data_ultimo_evento;
  if (!startValue) return null;

  const start = parseISO(startValue);
  return isValid(start) ? differenceInCalendarDays(new Date(), start) : null;
}

export function queueStageDate(sentence: SentenceRecord, stage: WorkflowStage) {
  return stage === "CUMPRIMENTO" ? sentence.envio_bcc : sentence.cumprimento_data;
}

export function slaDays(sentence: SentenceRecord, kind: "cumprimento" | "qualidade" | "pendente") {
  const today = new Date();
  if (kind === "cumprimento") {
    if (!sentence.tratado) return null;
    const start = parseISO(sentence.tratado);
    const end = sentence.cumprimento_status === "ENTREGUE" && sentence.cumprimento_data ? parseISO(sentence.cumprimento_data) : today;
    return isValid(start) && isValid(end) ? differenceInCalendarDays(end, start) : null;
  }

  if (kind === "qualidade") {
    if (sentence.cumprimento_status !== "ENTREGUE" || !sentence.cumprimento_data) return null;
    if (!["ESTOQUE", "EM ANDAMENTO"].includes(sentence.qualidade_status ?? "")) return null;
    const start = parseISO(sentence.cumprimento_data);
    return isValid(start) ? differenceInCalendarDays(today, start) : null;
  }

  if (!sentence.data_ultimo_evento) return null;
  if (sentence.cumprimento_status !== "PENDENTE" && sentence.qualidade_status !== "PENDENTE") return null;
  const start = parseISO(sentence.data_ultimo_evento);
  return isValid(start) ? differenceInCalendarDays(today, start) : null;
}

export function isOverdue(sentence: SentenceRecord) {
  if (!sentence.prazo_fatal) return false;
  const due = parseISO(sentence.prazo_fatal);
  if (!isValid(due)) return false;
  return differenceInCalendarDays(new Date(), due) > 0 && sentence.cumprimento_status !== "ENTREGUE";
}

export function initials(name: string | null | undefined) {
  return (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
