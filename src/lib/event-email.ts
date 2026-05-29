import type { EventType, SentenceRecord, WorkflowStage } from "@/lib/types";

export const SENTENCE_EMAIL_RECIPIENT = "CumprimentodeDecisoesJudiciais_Ampla@enel.com";

type SentenceEmailFields = Pick<SentenceRecord, "observacao" | "uc">;

export function buildEventTitle(
  stage: WorkflowStage,
  eventType: EventType,
  decisionType: string | null | undefined,
  processNumber: string,
) {
  return [stage, eventType, decisionType?.trim() || "-", processNumber].join(" - ");
}

export function buildSentenceEmailHref(subject: string, sentence: SentenceEmailFields) {
  const body = [
    "Prezados,",
    "",
    `UC: ${sentence.uc?.trim() || "-"}`,
    "",
    "Segue obriga\u00e7\u00e3o de fazer que deve ser cumprida:",
    sentence.observacao?.trim() || "-",
  ].join("\n");

  return `mailto:${SENTENCE_EMAIL_RECIPIENT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
