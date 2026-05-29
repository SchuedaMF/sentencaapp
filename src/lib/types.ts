export type AppRole = "admin" | "gestor" | "operador" | "analista";
export type WorkflowStage = "CUMPRIMENTO" | "QUALIDADE";
export type EventType = "PENDENTE" | "ENTREGUE";
export type SentenceStatus = "ENTREGUE" | "PENDENTE" | "EM ANDAMENTO" | "ESTOQUE";
export type QueueStatusMode = "ALL" | SentenceStatus;
export type ObfImportStatus = "importado" | "rejeitado" | "pendente";
export type ObfImportStatusMode = "all" | ObfImportStatus;
export type ObfImportViewMode = "arquivos" | "linhas";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  active: boolean;
};

export type ManagedUser = Profile & {
  created_at: string | null;
  updated_at: string | null;
};

export type AssignableProfile = {
  id: string;
  displayName: string;
  email: string;
  role: AppRole;
};

export type EventResponsibleOption = {
  id: string;
  displayName: string;
};

export type SentenceRecord = {
  id: string;
  legacy_id_sentenca: string | null;
  processo: string;
  data_publicacao: string | null;
  envio_bcc: string | null;
  origem_raw: string | null;
  origem_normalized: string | null;
  tratado: string | null;
  tipo_justica_raw: string | null;
  tipo_justica_normalized: string | null;
  cpf_cnpj: string | null;
  autor: string | null;
  tipo_cliente: string | null;
  uc: string | null;
  municipio_raw: string | null;
  municipio_normalized: string | null;
  tipo_decisao_raw: string | null;
  tipo_decisao_normalized: string | null;
  observacao: string | null;
  valor_multa: number | null;
  prazo_fatal: string | null;
  tipo_servico_raw: string | null;
  responsavel_cumprimento: string | null;
  responsavel_qualidade: string | null;
  pendencia: string | null;
  cumprimento_status: SentenceStatus | null;
  qualidade_status: SentenceStatus | null;
  cumprimento_data: string | null;
  qualidade_data: string | null;
  data_ultimo_evento: string | null;
  pendencia_base?: string | null;
  cumprimento_base_status?: SentenceStatus | null;
  qualidade_base_status?: SentenceStatus | null;
  cumprimento_base_data?: string | null;
  qualidade_base_data?: string | null;
  data_ultimo_evento_base?: string | null;
  import_warnings?: unknown[];
};

export type SentenceEvent = {
  id: string;
  sentence_id: string;
  etapa: WorkflowStage;
  tipo_evento: EventType;
  data_evento: string;
  responsavel: string | null;
  pendencia: string | null;
  area: string | null;
  obs: string | null;
  affects_operational_state?: boolean;
  legacy_id_andamento?: string | null;
  import_batch_id?: string | null;
  import_row_number?: number | null;
  created_by?: string | null;
  created_at: string;
  canEdit?: boolean;
};

export type SalesforceOrderStatusBucket = "open" | "closed" | "unknown";

export type SalesforceOrderRecord = {
  id: string;
  import_batch_id: string;
  import_row_number: number;
  is_latest: boolean;
  processo: string | null;
  processo_source: string | null;
  owner_name: string | null;
  supply_point_number: string | null;
  subject: string | null;
  salesforce_case_number: string | null;
  case_status: string | null;
  status_bucket: SalesforceOrderStatusBucket;
  is_open: boolean;
  order_number: string | null;
  order_state: string | null;
  synergia_order_number: string | null;
  order_status: string | null;
  order_key: string | null;
  opened_at: string | null;
  created_on: string | null;
  reason: string | null;
  subreason: string | null;
  origin_channel: string | null;
  municipality: string | null;
  case_observations: string | null;
  company_client_id: string | null;
  observations_prefixed: string | null;
  observations: string | null;
  segment_type: string | null;
  primary_contact_name: string | null;
  created_at: string;
};

export type SalesforceOrderGroup = {
  key: string;
  displayOrderNumber: string;
  rows: SalesforceOrderRecord[];
  rowCount: number;
  isOpen: boolean;
  latestRow: SalesforceOrderRecord;
  orderStates: string[];
  orderStatuses: string[];
};

export type SalesforceOrderQueueSummary = {
  totalOrders: number;
  openOrders: number;
  closedOrders: number;
  unknownOrders: number;
};

export type SalesforceOrdersSummary = {
  totalRows: number;
  openRows: number;
  closedRows: number;
  canceledRows: number;
  unknownRows: number;
  latestImportedAt: string | null;
  groups: SalesforceOrderGroup[];
};

export type ObfImportVerificationRecord = {
  id: string;
  row_key: string | null;
  arquivo_rel: string | null;
  arquivo_size_bytes: number | string | null;
  data_operacional: string | null;
  escritorio: string | null;
  tipo_fluxo: string | null;
  linha_origem: number | null;
  processo: string | null;
  envio_bcc: string | null;
  status_importacao: ObfImportStatus;
  motivo_status: string | null;
  destino_tabela: string | null;
  imported_record_id: string | null;
  import_batch_id: string | null;
  importado_em: string | null;
  verificado_em: string | null;
  created_at: string;
  updated_at: string;
  batch_key?: string | null;
};

export type ObfImportFileRecord = {
  batch_key: string;
  import_batch_id: string | null;
  file_name: string;
  file_size_bytes: number | string | null;
  imported_at: string | null;
  source_kind: string | null;
  total_rows: number | string;
  importado_count: number | string;
  rejeitado_count: number | string;
  pendente_count: number | string;
  warning_count: number | string;
  inconsistency_count: number | string;
  matched_rows: number | string;
};

export type ObfImportVerificationSummary = {
  statusCounts: Record<ObfImportStatus, number>;
  total: number;
  offices: Array<[string, number]>;
  rejectedReasons: Array<[string, number]>;
  latestVerifiedAt: string | null;
  isManager: boolean;
};

export type ObfImportVerificationResult = {
  records: ObfImportVerificationRecord[];
  nextCursor: string | null;
  pageSize: number;
  offset: number;
  total: number;
  isManager: boolean;
};

export type ObfImportFilesResult = {
  files: ObfImportFileRecord[];
  nextCursor: string | null;
  pageSize: number;
  offset: number;
  total: number;
  isManager: boolean;
};

export type SentenceProcessDuplicate = Pick<
  SentenceRecord,
  | "id"
  | "legacy_id_sentenca"
  | "processo"
  | "autor"
  | "cpf_cnpj"
  | "uc"
  | "municipio_raw"
  | "tipo_decisao_normalized"
  | "observacao"
  | "responsavel_cumprimento"
  | "responsavel_qualidade"
  | "cumprimento_status"
  | "qualidade_status"
  | "cumprimento_data"
  | "qualidade_data"
  | "data_ultimo_evento"
> & {
  is_current: boolean;
  event_count: number | string | null;
  order_total: number | string | null;
  order_open: number | string | null;
  order_closed: number | string | null;
  order_unknown: number | string | null;
};

export type DashboardPoint = {
  date: string;
  recebido: number;
  cumprimento: number;
  qualidade: number;
  pendente: number;
};

export type DashboardStatus = Record<Exclude<SentenceStatus, "ENTREGUE">, number>;
export type ProductionKind = "cumprimento" | "qualidade";
export type ProductionPeriod = "month" | "day";

export type DashboardProductionRankingRow = {
  name: string;
  position: number;
  value: number;
  total: number;
  delivered: number;
  pending: number;
  isCurrentUser: boolean;
};

export type DashboardProduction = {
  today: Record<ProductionKind, number>;
  month: Record<ProductionKind, number>;
  occurrenceDays: Record<ProductionKind, number>;
  ranking: Record<ProductionKind, Record<ProductionPeriod, DashboardProductionRankingRow[]>>;
};

export type DashboardMetrics = {
  cumprimentoStatus: DashboardStatus;
  qualidadeStatus: DashboardStatus;
  points: DashboardPoint[];
  people: Array<{ name: string; cumprimento: number; qualidade: number; pendente: number }>;
  total: number;
  overdue: number;
  currentUser: {
    name: string;
    role: AppRole;
  };
  production: DashboardProduction;
};
