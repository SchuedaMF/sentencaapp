export const eventPendingOptions = [
  "QUESTIONAMENTO AO ESCRITÓRIO",
  "ÁREA",
  "PETICIONADO",
  "CUMPRIMENTO INCORRETO",
] as const;

export type EventPendingOption = (typeof eventPendingOptions)[number];

export const eventAreaOtherValue = "__other__";

export const eventAreaOptions = [
  "ALTERAÇÕES CADASTRAIS",
  "REFATURAMENTO",
  "ENVIO DE AR",
  "TOI",
  "FATURAMENTO",
  "VISTORIA",
  "MANUTENÇÃO",
  "COBRANÇA PROTESTO/ESPECIAIS",
  "LIGAÇÃO NOVA",
  "CANCELAMENTO DE TOI",
  "CORTE/RELIGAÇÃO",
  "SUBSTITUIÇÃO DE MEDIDOR",
  "TROCA DE TITULARIDADE",
  "CRÉDITO ACORDO",
  "RCE",
  "ESCRITÓRIO",
  "EVIDÊNCIAS",
  "GD",
  "OBRAS",
  "PARCELAMENTO",
  "ACRÉSCIMO DE CARGA",
  "BAIXA RENDA",
  "ENCERRAMENTO CONTRATUAL",
  "GRUPO A",
  "REFORMA DE PADRÃO",
  "RELIGAÇÃO",
  "REPARO MEDIDOR",
  "RESSARCIMENTO",
  "TRANSFERÊNCIA DE DÉBITOS",
] as const;

export type EventAreaOption = (typeof eventAreaOptions)[number];

type EventAreaAliasValue = EventAreaOption | null;

const eventPendingAliases: Record<string, EventPendingOption> = {
  AREA: "ÁREA",
  QUESTIONADO: "QUESTIONAMENTO AO ESCRITÓRIO",
  QUESTIONADOAOESCRITORIO: "QUESTIONAMENTO AO ESCRITÓRIO",
  "QUESTIONADO AO ESCRITORIO": "QUESTIONAMENTO AO ESCRITÓRIO",
  "QUESTIONAMENTO AO ESCRITORIO": "QUESTIONAMENTO AO ESCRITÓRIO",
  ESCRITORIO: "QUESTIONAMENTO AO ESCRITÓRIO",
  "PETICIONAMENTO ESCRITORIO": "PETICIONADO",
  PETICIONADO: "PETICIONADO",
  "CUMPRIMENTO INCOMPLETO": "CUMPRIMENTO INCORRETO",
  "CUMPRIMENTO INCORRETO": "CUMPRIMENTO INCORRETO",
  "ANALISE DE CONS INCLUIDO": "ÁREA",
  "CANCELAR DEBITO": "ÁREA",
};

const eventAreaAliases: Record<string, EventAreaAliasValue> = {
  AREA: null,
  "ALT CADASTRAIS": "ALTERAÇÕES CADASTRAIS",
  "ALTERACAO CADASTRAL": "ALTERAÇÕES CADASTRAIS",
  "ALTERACOES CADASTRAIS": "ALTERAÇÕES CADASTRAIS",
  "ACRESCIMO DE CARGA": "ACRÉSCIMO DE CARGA",
  AR: "ENVIO DE AR",
  "ENVIO DE A.R": "ENVIO DE AR",
  "ENVIO DE AR": "ENVIO DE AR",
  MANUTENCAO: "MANUTENÇÃO",
  "COBRANCA PROTESTO/ESPECIAIS": "COBRANÇA PROTESTO/ESPECIAIS",
  "LIGACAO NOVA": "LIGAÇÃO NOVA",
  "CANCELAMENTO TOI": "CANCELAMENTO DE TOI",
  "CANCELAMENTO DE TOI": "CANCELAMENTO DE TOI",
  "CORTE/RELIGACAO": "CORTE/RELIGAÇÃO",
  "SUBSTITUICAO DE MEDIDDOR": "SUBSTITUIÇÃO DE MEDIDOR",
  "SUBSTITUICAO DE MEDIDOR": "SUBSTITUIÇÃO DE MEDIDOR",
  "CREDITO ACORDO": "CRÉDITO ACORDO",
  ESCRITORIO: "ESCRITÓRIO",
  ESC: "ESCRITÓRIO",
  EVIDENCIAS: "EVIDÊNCIAS",
  GD: "GD",
  "REFAT GD": "GD",
  "REFORMA DE PADRAO": "REFORMA DE PADRÃO",
  RELIGACAO: "RELIGAÇÃO",
  "TRANSFERENCIA DE DEBITOS": "TRANSFERÊNCIA DE DÉBITOS",
};

const eventAreaOptionSet = new Set<string>(eventAreaOptions);

export type EventAreaInputResult =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

export function cleanEventTaxonomyText(value: string | null | undefined) {
  const cleaned = String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned ? cleaned.toLocaleUpperCase("pt-BR") : "";
}

export function normalizeEventTaxonomyKey(value: string | null | undefined) {
  return cleanEventTaxonomyText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function canonicalizeEventPendencia(value: string | null | undefined): EventPendingOption | null {
  const key = normalizeEventTaxonomyKey(value);
  if (!key) return null;

  const direct = eventPendingAliases[key];
  if (direct) return direct;

  return canonicalizeKnownEventArea(value) ? "ÁREA" : null;
}

export function canonicalizeKnownEventArea(value: string | null | undefined): EventAreaOption | null {
  const key = normalizeEventTaxonomyKey(value);
  if (!key) return null;

  if (Object.prototype.hasOwnProperty.call(eventAreaAliases, key)) return eventAreaAliases[key];

  const cleaned = cleanEventTaxonomyText(value);
  return eventAreaOptionSet.has(cleaned) ? (cleaned as EventAreaOption) : null;
}

export function normalizeCustomEventArea(value: string | null | undefined) {
  const cleaned = cleanEventTaxonomyText(value);
  if (!cleaned || normalizeEventTaxonomyKey(cleaned) === "AREA") return null;

  return canonicalizeKnownEventArea(cleaned) ?? cleaned;
}

export function resolveEventAreaInput(area: string | null | undefined, areaCustom: string | null | undefined): EventAreaInputResult {
  const selected = String(area ?? "").trim();
  if (!selected) return { ok: true, value: null };

  if (selected === eventAreaOtherValue) {
    const customArea = normalizeCustomEventArea(areaCustom);
    if (!customArea) return { ok: false, message: "Informe a área em Outro." };
    return { ok: true, value: customArea };
  }

  const knownArea = canonicalizeKnownEventArea(selected);
  if (!knownArea) return { ok: false, message: "Selecione uma área válida ou use Outro." };

  return { ok: true, value: knownArea };
}

export function getEventAreaSelectDefaults(value: string | null | undefined) {
  const cleaned = cleanEventTaxonomyText(value);
  if (!cleaned) return { selectValue: "", customValue: "" };

  const knownArea = canonicalizeKnownEventArea(value);
  if (knownArea) return { selectValue: knownArea, customValue: "" };

  return { selectValue: eventAreaOtherValue, customValue: cleaned };
}
