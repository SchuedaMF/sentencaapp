import type { DashboardMetrics, DashboardProduction, DashboardStatus, ProductionKind, ProductionPeriod, Profile, SalesforceOrderRecord, SentenceEvent, SentenceRecord, SentenceStatus } from "@/lib/types";
import { isOverdue, statusLabels } from "@/lib/normalization";
import { canViewAllOperationalData } from "@/lib/permissions";

const dashboardStatusLabels = statusLabels.filter((status): status is Exclude<SentenceStatus, "ENTREGUE"> => status !== "ENTREGUE");

export const sampleProfile: Profile = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "demo@sentencarj.local",
  full_name: "Admin Demo",
  role: "admin",
  active: true,
};

export const sampleSentences: SentenceRecord[] = [
  {
    id: "demo-1",
    legacy_id_sentenca: "0801419-83.2023.8.19.0075",
    processo: "0801419-83.2023.8.19.0075",
    data_publicacao: "2025-10-07",
    envio_bcc: "2025-10-16",
    origem_raw: "TAUNAY",
    origem_normalized: "TAUNAY",
    tratado: "2025-10-17",
    tipo_justica_raw: "1VARA CÍVEL",
    tipo_justica_normalized: "1VARA CIVEL",
    cpf_cnpj: "094.349.267-00",
    autor: "Cliente exemplo",
    tipo_cliente: "B2C",
    uc: "4730924",
    municipio_raw: "NITERÓI",
    municipio_normalized: "NITEROI",
    tipo_decisao_raw: "ACÓRDÃO",
    tipo_decisao_normalized: "ACORDAO",
    observacao: "Promover refaturamento dos débitos referentes às faturas e enviar evidências para cumprimento.",
    valor_multa: 500,
    prazo_fatal: "2026-04-15",
    tipo_servico_raw: "REFATURAMENTO, COBRANÇAS ESPECIAIS",
    responsavel_cumprimento: "LUCAS",
    responsavel_qualidade: "ANTHONY",
    pendencia: "ÁREA",
    cumprimento_status: "ENTREGUE",
    qualidade_status: "PENDENTE",
    cumprimento_data: "2026-04-09",
    qualidade_data: null,
    data_ultimo_evento: "2026-04-11",
  },
  {
    id: "demo-2",
    legacy_id_sentenca: "0806638-05.2024.8.19.0023",
    processo: "0806638-05.2024.8.19.0023",
    data_publicacao: "2025-10-02",
    envio_bcc: "2025-10-17",
    origem_raw: "VILLEMOR",
    origem_normalized: "VILLEMOR",
    tratado: "2025-10-20",
    tipo_justica_raw: "COMUM",
    tipo_justica_normalized: "COMUM",
    cpf_cnpj: "620.108.597-10",
    autor: "Autora exemplo",
    tipo_cliente: "B2C",
    uc: "6204793",
    municipio_raw: "CABO FRIO",
    municipio_normalized: "CABO FRIO",
    tipo_decisao_raw: "SENTENÇA",
    tipo_decisao_normalized: "SENTENCA",
    observacao: "Cancelar cobrança e juntar comprovante.",
    valor_multa: 0,
    prazo_fatal: "2026-05-03",
    tipo_servico_raw: "CANCELAMENTO DE TOI",
    responsavel_cumprimento: "WELLINGTON",
    responsavel_qualidade: "ARYANNE",
    pendencia: "QUESTIONAMENTO AO ESCRITÓRIO",
    cumprimento_status: "PENDENTE",
    qualidade_status: "ESTOQUE",
    cumprimento_data: null,
    qualidade_data: null,
    data_ultimo_evento: "2026-04-18",
  },
  {
    id: "demo-3",
    legacy_id_sentenca: "0811134-19.2025.8.19.0031",
    processo: "0811134-19.2025.8.19.0031",
    data_publicacao: "2025-09-15",
    envio_bcc: "2025-11-03",
    origem_raw: "VALENCA",
    origem_normalized: "VALENCA",
    tratado: "2026-04-09",
    tipo_justica_raw: "JUIZADO ESPECIAL",
    tipo_justica_normalized: "JUIZADO ESPECIAL",
    cpf_cnpj: "083.147.367-44",
    autor: "Requerente exemplo",
    tipo_cliente: "B2C",
    uc: "8560368",
    municipio_raw: "PETRÓPOLIS",
    municipio_normalized: "PETROPOLIS",
    tipo_decisao_raw: "SENTENÇA",
    tipo_decisao_normalized: "SENTENCA",
    observacao: "Ordem aberta para vistoria e refaturamento.",
    valor_multa: 100,
    prazo_fatal: "2026-05-08",
    tipo_servico_raw: "VISTORIA, REFATURAMENTO",
    responsavel_cumprimento: "CAROL",
    responsavel_qualidade: "CAROL",
    pendencia: null,
    cumprimento_status: "EM ANDAMENTO",
    qualidade_status: "EM ANDAMENTO",
    cumprimento_data: null,
    qualidade_data: null,
    data_ultimo_evento: "2026-04-22",
  },
];

export const sampleEvents: SentenceEvent[] = [
  {
    id: "event-1",
    sentence_id: "demo-1",
    etapa: "CUMPRIMENTO",
    tipo_evento: "ENTREGUE",
    data_evento: "2026-04-09",
    responsavel: "LUCAS",
    pendencia: null,
    area: null,
    obs: "Cumprimento entregue.",
    created_by: sampleProfile.id,
    created_at: "2026-04-09T12:00:00Z",
    canEdit: true,
  },
  {
    id: "event-2",
    sentence_id: "demo-1",
    etapa: "QUALIDADE",
    tipo_evento: "PENDENTE",
    data_evento: "2026-04-11",
    responsavel: "ANTHONY",
    pendencia: "ÁREA",
    area: "REFATURAMENTO",
    obs: "Aguardando evidÃªncia complementar.",
    created_by: sampleProfile.id,
    created_at: "2026-04-11T12:00:00Z",
    canEdit: true,
  },
];

export const sampleSalesforceOrders: SalesforceOrderRecord[] = [
  {
    id: "salesforce-order-1",
    import_batch_id: "demo-batch",
    import_row_number: 2,
    is_latest: true,
    processo: "0801419-83.2023.8.19.0075",
    processo_source: "assunto",
    owner_name: "Equipe Salesforce",
    supply_point_number: "4730924",
    subject: "0801419-83.2023.8.19.0075",
    salesforce_case_number: "977000001",
    case_status: "Em processo",
    status_bucket: "open",
    is_open: true,
    order_number: "A054900001",
    order_state: "ORDEM EM EXECUCAO",
    synergia_order_number: "A054900001",
    order_status: "ORDEM EM EXECUCAO",
    order_key: "A054900001",
    opened_at: "2026-04-28T13:00:00-03:00",
    created_on: "2026-04-28",
    reason: "JURIDICO",
    subreason: "SOLICITACAO DE REFATURAM- JUIZADO",
    origin_channel: "JUDICIAL",
    municipality: "NITEROI",
    case_observations: null,
    company_client_id: "2005",
    observations_prefixed: "Observacoes: processo em demonstracao.",
    observations: "Processo em demonstracao.",
    segment_type: "Grupo B",
    primary_contact_name: "Cliente exemplo",
    created_at: "2026-04-28T16:00:00Z",
  },
  {
    id: "salesforce-order-2",
    import_batch_id: "demo-batch",
    import_row_number: 3,
    is_latest: true,
    processo: "0806638-05.2024.8.19.0023",
    processo_source: "observacoes",
    owner_name: "Equipe Salesforce",
    supply_point_number: "6204793",
    subject: "Troca de Titular",
    salesforce_case_number: "977000002",
    case_status: "Fechado",
    status_bucket: "closed",
    is_open: false,
    order_number: "A054900002",
    order_state: "ORDEM FINALIZADA",
    synergia_order_number: "A054900002",
    order_status: "ORDEM FINALIZADA",
    order_key: "A054900002",
    opened_at: "2026-04-25T10:30:00-03:00",
    created_on: "2026-04-25",
    reason: "JURIDICO",
    subreason: "CANCELAMENTO DE TOI - JUIZADO",
    origin_channel: "JUDICIAL",
    municipality: "CABO FRIO",
    case_observations: null,
    company_client_id: "2005",
    observations_prefixed: null,
    observations: "Sentenca - 0806638-05.2024.8.19.0023",
    segment_type: "Grupo B",
    primary_contact_name: "Autora exemplo",
    created_at: "2026-04-28T16:00:00Z",
  },
];

export function buildSampleDashboard(profile: Profile = sampleProfile): DashboardMetrics {
  const statusTemplate = Object.fromEntries(dashboardStatusLabels.map((status) => [status, 0])) as DashboardStatus;
  const cumprimentoStatus = { ...statusTemplate };
  const qualidadeStatus = { ...statusTemplate };
  const people = new Map<string, { name: string; cumprimento: number; qualidade: number; pendente: number }>();
  const currentUserName = profile.full_name?.trim() || profile.email;

  for (const sentence of sampleSentences) {
    if (sentence.cumprimento_status && sentence.cumprimento_status !== "ENTREGUE") cumprimentoStatus[sentence.cumprimento_status] += 1;
    if (sentence.qualidade_status && sentence.qualidade_status !== "ENTREGUE") qualidadeStatus[sentence.qualidade_status] += 1;
    for (const [name, kind] of [
      [sentence.responsavel_cumprimento, "cumprimento"],
      [sentence.responsavel_qualidade, "qualidade"],
    ] as const) {
      if (!name) continue;
      const row = people.get(name) ?? { name, cumprimento: 0, qualidade: 0, pendente: 0 };
      row[kind] += 1;
      if (sentence.cumprimento_status === "PENDENTE" || sentence.qualidade_status === "PENDENTE") row.pendente += 1;
      people.set(name, row);
    }
  }

  return {
    cumprimentoStatus,
    qualidadeStatus,
    total: sampleSentences.filter((sentence) => sentence.qualidade_status !== "ENTREGUE").length,
    overdue: sampleSentences.filter(isOverdue).length,
    currentUser: {
      name: currentUserName,
      role: profile.role,
    },
    production: buildSampleProduction(currentUserName, canSeeFullProduction(profile)),
    people: [...people.values()],
    points: [
      { date: "2026-04-09", recebido: 2, cumprimento: 1, qualidade: 0, pendente: 1 },
      { date: "2026-04-11", recebido: 1, cumprimento: 0, qualidade: 0, pendente: 1 },
      { date: "2026-04-18", recebido: 3, cumprimento: 0, qualidade: 0, pendente: 2 },
      { date: "2026-04-22", recebido: 1, cumprimento: 0, qualidade: 0, pendente: 1 },
    ],
  };
}

type SampleProductionPerson = {
  key: string;
  name: string;
  counts: SampleProductionCountsByKind;
  occurrenceDays: Record<ProductionKind, number>;
  isCurrentUser: boolean;
};

type ProductionMeasure = "total" | "delivered" | "pending";
type SampleProductionMetricCounts = Record<ProductionMeasure, number>;
type SampleProductionPeriodCounts = Record<ProductionPeriod, SampleProductionMetricCounts>;
type SampleProductionCountsByKind = Record<ProductionKind, SampleProductionPeriodCounts>;
type ProductionDaySets = Record<ProductionKind, Set<string>>;

function buildSampleProduction(currentUserName: string, showFullOperation: boolean): DashboardProduction {
  const todayKey = new Date().toISOString().slice(0, 10);
  const currentUserKey = normalizeResponsibleKey(currentUserName);
  const people = new Map<string, SampleProductionPerson>();
  const operationCounts = emptySampleProductionCountsByKind();
  const operationOccurrenceDaySets = emptyProductionDaySets();
  const personOccurrenceDaySets = new Map<string, ProductionDaySets>();

  people.set(currentUserKey, {
    key: currentUserKey,
    name: currentUserName,
    counts: emptySampleProductionCountsByKind(),
    occurrenceDays: { cumprimento: 0, qualidade: 0 },
    isCurrentUser: true,
  });
  personOccurrenceDaySets.set(currentUserKey, emptyProductionDaySets());

  for (const event of sampleEvents) {
    const responsible = event.responsavel?.trim();
    const responsibleKey = normalizeResponsibleKey(responsible);
    if (!responsible || !responsibleKey) continue;

    const row = people.get(responsibleKey) ?? {
      key: responsibleKey,
      name: responsible,
      counts: emptySampleProductionCountsByKind(),
      occurrenceDays: { cumprimento: 0, qualidade: 0 },
      isCurrentUser: responsibleKey === currentUserKey,
    };
    const kind: ProductionKind = event.etapa === "CUMPRIMENTO" ? "cumprimento" : "qualidade";
    const measure: ProductionMeasure = event.tipo_evento === "ENTREGUE" ? "delivered" : "pending";
    const occurrenceDaySets = personOccurrenceDaySets.get(responsibleKey) ?? emptyProductionDaySets();

    addSampleProductionCount(row.counts, kind, "month", "total", 1);
    addSampleProductionCount(row.counts, kind, "month", measure, 1);
    addSampleProductionCount(operationCounts, kind, "month", "total", 1);
    addSampleProductionCount(operationCounts, kind, "month", measure, 1);
    operationOccurrenceDaySets[kind].add(event.data_evento);
    occurrenceDaySets[kind].add(event.data_evento);
    if (event.data_evento === todayKey) {
      addSampleProductionCount(row.counts, kind, "day", "total", 1);
      addSampleProductionCount(row.counts, kind, "day", measure, 1);
      addSampleProductionCount(operationCounts, kind, "day", "total", 1);
      addSampleProductionCount(operationCounts, kind, "day", measure, 1);
    }

    if (responsibleKey === currentUserKey && event.data_evento === todayKey) {
      row.name = currentUserName;
      row.isCurrentUser = true;
    }
    people.set(responsibleKey, row);
    personOccurrenceDaySets.set(responsibleKey, occurrenceDaySets);
  }

  const currentUser = people.get(currentUserKey)!;
  currentUser.occurrenceDays = countProductionDaySets(personOccurrenceDaySets.get(currentUserKey) ?? emptyProductionDaySets());

  return {
    today: showFullOperation
      ? sampleProductionTotalCountsForPeriod(operationCounts, "day")
      : sampleProductionTotalCountsForPeriod(currentUser.counts, "day"),
    month: showFullOperation
      ? sampleProductionTotalCountsForPeriod(operationCounts, "month")
      : sampleProductionTotalCountsForPeriod(currentUser.counts, "month"),
    occurrenceDays: showFullOperation ? countProductionDaySets(operationOccurrenceDaySets) : { ...currentUser.occurrenceDays },
    ranking: buildSampleRanking([...people.values()], showFullOperation),
  };
}

function buildSampleRanking(
  people: SampleProductionPerson[],
  showFullOperation: boolean,
): DashboardProduction["ranking"] {
  return {
    cumprimento: {
      month: buildSampleRankingRows(people, "cumprimento", "month", showFullOperation),
      day: buildSampleRankingRows(people, "cumprimento", "day", showFullOperation),
    },
    qualidade: {
      month: buildSampleRankingRows(people, "qualidade", "month", showFullOperation),
      day: buildSampleRankingRows(people, "qualidade", "day", showFullOperation),
    },
  };
}

function buildSampleRankingRows(
  people: SampleProductionPerson[],
  kind: ProductionKind,
  period: ProductionPeriod,
  showFullOperation: boolean,
): DashboardProduction["ranking"][ProductionKind][ProductionPeriod] {
  const ranked = people
    .map((person) => {
      const counts = person.counts[kind][period];
      return { person, counts, value: counts.total };
    })
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value || a.person.name.localeCompare(b.person.name) || a.person.key.localeCompare(b.person.key))
    .map(({ person, counts, value }, index) => ({
      name: showFullOperation || person.isCurrentUser ? person.name : `Operador ${index + 1}`,
      position: index + 1,
      value,
      total: counts.total,
      delivered: counts.delivered,
      pending: counts.pending,
      isCurrentUser: person.isCurrentUser,
    }));

  return showFullOperation ? ranked : ranked.slice(0, 8);
}

function emptySampleProductionMetricCounts(): SampleProductionMetricCounts {
  return { total: 0, delivered: 0, pending: 0 };
}

function emptySampleProductionPeriodCounts(): SampleProductionPeriodCounts {
  return {
    month: emptySampleProductionMetricCounts(),
    day: emptySampleProductionMetricCounts(),
  };
}

function emptySampleProductionCountsByKind(): SampleProductionCountsByKind {
  return {
    cumprimento: emptySampleProductionPeriodCounts(),
    qualidade: emptySampleProductionPeriodCounts(),
  };
}

function addSampleProductionCount(
  counts: SampleProductionCountsByKind,
  kind: ProductionKind,
  period: ProductionPeriod,
  measure: ProductionMeasure,
  value: number,
) {
  counts[kind][period][measure] += value;
}

function sampleProductionTotalCountsForPeriod(
  counts: SampleProductionCountsByKind,
  period: ProductionPeriod,
): Record<ProductionKind, number> {
  return {
    cumprimento: counts.cumprimento[period].total,
    qualidade: counts.qualidade[period].total,
  };
}

function emptyProductionDaySets(): ProductionDaySets {
  return { cumprimento: new Set(), qualidade: new Set() };
}

function countProductionDaySets(daySets: ProductionDaySets): Record<ProductionKind, number> {
  return { cumprimento: daySets.cumprimento.size, qualidade: daySets.qualidade.size };
}

function normalizeResponsibleKey(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

function canSeeFullProduction(profile: Pick<Profile, "active" | "role">) {
  return canViewAllOperationalData(profile);
}
