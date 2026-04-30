"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canonicalizeEventPendencia, resolveEventAreaInput } from "@/lib/event-taxonomy";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { EventPendingOption } from "@/lib/event-taxonomy";
import type { AppRole, QueueStatusMode, WorkflowStage } from "@/lib/types";

const noResponsibleValue = "__none__";
const preserveResponsibleValue = "__current__";

const eventSchema = z.object({
  sentenceId: z.string().min(1),
  etapa: z.enum(["CUMPRIMENTO", "QUALIDADE"]),
  tipoEvento: z.enum(["PENDENTE", "ENTREGUE"]),
  dataEvento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  responsavelProfileId: z.union([z.literal(noResponsibleValue), z.literal(preserveResponsibleValue), z.string().uuid()]),
  pendencia: z.string().trim().optional(),
  area: z.string().trim().optional(),
  areaCustom: z.string().trim().optional(),
  obs: z.string().trim().optional(),
});

const eventIdSchema = z.string().uuid();

const operatorUserSchema = z.object({
  fullName: z.string().trim().min(2, "Informe o nome do operador.").max(120, "Use um nome menor."),
  email: z.string().trim().toLowerCase().email("Informe um e-mail vÃ¡lido."),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres.").max(72, "Use uma senha menor."),
});

const bulkAssignSchema = z.object({
  stage: z.enum(["CUMPRIMENTO", "QUALIDADE"]),
  mode: z.enum(["selected", "filtered"]),
  statusMode: z.enum(["ALL", "ENTREGUE", "PENDENTE", "EM ANDAMENTO", "ESTOQUE"]),
  query: z.string().trim().optional(),
  responsible: z.string().trim().optional(),
  targetProfileId: z.union([z.literal(noResponsibleValue), z.string().uuid()]),
  sentenceIds: z.array(z.string().trim().min(1)).max(100),
});

type EventActionState = {
  ok: boolean;
  message: string;
};

type EventPayload = Omit<z.infer<typeof eventSchema>, "pendencia" | "area" | "areaCustom"> & {
  pendencia: EventPendingOption | null;
  area: string | null;
};

type ParsedEventPayload =
  | { ok: true; data: EventPayload }
  | { ok: false; message: string };

export type CreateOperatorUserState = {
  ok: boolean;
  message: string;
  errors?: Partial<Record<"fullName" | "email" | "password", string[]>>;
};

export type BulkAssignResponsibleState = {
  ok: boolean;
  message: string;
  updated: number;
  skipped: number;
};

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/dashboard");

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);

  await ensureInitialAdmin(email);
  redirect("/dashboard");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/login");
}

export async function saveEventAction(state: EventActionState | null, formData: FormData) {
  const eventId = String(formData.get("eventId") ?? "").trim();
  if (!eventId) return createEventAction(state, formData);

  const parsedEventId = eventIdSchema.safeParse(eventId);
  if (!parsedEventId.success) return { ok: false, message: "Evento inválido." };

  return updateEventAction(parsedEventId.data, state, formData);
}

export async function createEventAction(_: EventActionState | null, formData: FormData): Promise<EventActionState> {
  const parsed = parseEventPayload(formData);
  if (!parsed.ok) return parsed;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, message: "Modo demonstração: conecte o Supabase para gravar eventos." };

  const { data: auth } = await supabase.auth.getUser();
  const payload = parsed.data;
  const responsible = await resolveEventResponsible(supabase, payload.responsavelProfileId, null);
  if (!responsible.ok) return { ok: false, message: responsible.message };

  const { data: insertedEvent, error } = await supabase
    .from("sentence_events")
    .insert({
      sentence_id: payload.sentenceId,
      etapa: payload.etapa,
      tipo_evento: payload.tipoEvento,
      data_evento: payload.dataEvento,
      responsavel: responsible.value,
      pendencia: payload.pendencia || null,
      area: payload.area || null,
      obs: payload.obs || null,
      created_by: auth.user?.id ?? null,
    })
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, message: error.message };
  if (!insertedEvent) return { ok: false, message: "Não foi possível gravar o evento." };

  revalidateSentenceEventPaths(payload.sentenceId);
  return { ok: true, message: "Evento registrado e campos canônicos atualizados." };
}

export async function updateEventAction(eventId: string, _: EventActionState | null, formData: FormData): Promise<EventActionState> {
  const parsed = parseEventPayload(formData);
  if (!parsed.ok) return parsed;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, message: "Modo demonstração: conecte o Supabase para gravar eventos." };

  const payload = parsed.data;
  const { data: existingEvent, error: lookupError } = await supabase
    .from("sentence_events")
    .select("id,sentence_id,responsavel")
    .eq("id", eventId)
    .maybeSingle();

  if (lookupError) return { ok: false, message: lookupError.message };
  if (!existingEvent) return { ok: false, message: "Evento não encontrado." };
  if (existingEvent.sentence_id !== payload.sentenceId) return { ok: false, message: "Evento não pertence a esta sentença." };

  const responsible = await resolveEventResponsible(supabase, payload.responsavelProfileId, existingEvent.responsavel);
  if (!responsible.ok) return { ok: false, message: responsible.message };

  const { data: updatedEvent, error } = await supabase
    .from("sentence_events")
    .update({
      etapa: payload.etapa,
      tipo_evento: payload.tipoEvento,
      data_evento: payload.dataEvento,
      responsavel: responsible.value,
      pendencia: payload.pendencia || null,
      area: payload.area || null,
      obs: payload.obs || null,
    })
    .eq("id", eventId)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, message: error.message };
  if (!updatedEvent) return { ok: false, message: "Não foi possível atualizar o evento." };

  revalidateSentenceEventPaths(payload.sentenceId);
  return { ok: true, message: "Evento atualizado e campos canônicos atualizados." };
}

export async function deleteEventAction(eventId: string, _: EventActionState | null, _formData: FormData): Promise<EventActionState> {
  void _formData;

  const parsedEventId = eventIdSchema.safeParse(eventId);
  if (!parsedEventId.success) return { ok: false, message: "Evento inválido." };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, message: "Modo demonstração: conecte o Supabase para remover eventos." };

  const { data: deletedEvent, error } = await supabase
    .from("sentence_events")
    .delete()
    .eq("id", parsedEventId.data)
    .select("sentence_id")
    .maybeSingle();

  if (error) return { ok: false, message: error.message };
  if (!deletedEvent) return { ok: false, message: "Evento não encontrado." };

  revalidateSentenceEventPaths(deletedEvent.sentence_id);
  return { ok: true, message: "Evento excluído com sucesso." };
}

function revalidateSentenceEventPaths(sentenceId: string) {
  revalidatePath(`/sentencas/${sentenceId}`);
  revalidatePath("/dashboard");
  revalidatePath("/fila");
  revalidatePath("/cumprimento");
  revalidatePath("/qualidade");
}

function parseEventPayload(formData: FormData): ParsedEventPayload {
  const parsed = eventSchema.safeParse({
    sentenceId: formData.get("sentenceId"),
    etapa: formData.get("etapa"),
    tipoEvento: formData.get("tipoEvento"),
    dataEvento: formData.get("dataEvento"),
    responsavelProfileId: formData.get("responsavelProfileId") ?? noResponsibleValue,
    pendencia: formData.get("pendencia") ?? "",
    area: formData.get("area") ?? "",
    areaCustom: formData.get("areaCustom") ?? "",
    obs: formData.get("obs"),
  });

  if (!parsed.success) return { ok: false, message: "Revise os campos obrigatórios do evento." };

  const rawPendencia = parsed.data.pendencia?.trim() ?? "";
  const pendencia = canonicalizeEventPendencia(rawPendencia);
  if (rawPendencia && !pendencia) return { ok: false, message: "Selecione uma pendência válida." };

  const area = resolveEventAreaInput(parsed.data.area, parsed.data.areaCustom);
  if (!area.ok) return { ok: false, message: area.message };

  return {
    ok: true,
    data: {
      sentenceId: parsed.data.sentenceId,
      etapa: parsed.data.etapa,
      tipoEvento: parsed.data.tipoEvento,
      dataEvento: parsed.data.dataEvento,
      responsavelProfileId: parsed.data.responsavelProfileId,
      pendencia,
      area: area.value,
      obs: parsed.data.obs,
    },
  };
}

type EventResponsibleResult =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

async function resolveEventResponsible(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  responsavelProfileId: string,
  currentResponsible: string | null | undefined,
): Promise<EventResponsibleResult> {
  if (responsavelProfileId === noResponsibleValue) return { ok: true, value: null };

  if (responsavelProfileId === preserveResponsibleValue) {
    const preserved = currentResponsible?.trim();
    if (preserved) return { ok: true, value: preserved };
    return { ok: false, message: "Responsável atual não encontrado para preservação." };
  }

  const profileClient = createSupabaseAdminClient() ?? supabase;
  const { data, error } = await profileClient
    .from("profiles")
    .select("id,email,full_name")
    .eq("id", responsavelProfileId)
    .eq("active", true)
    .maybeSingle();

  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: false, message: "Responsável ativo não encontrado." };

  const responsible = String(data.full_name || data.email || "").trim();
  if (!responsible) return { ok: false, message: "Responsável ativo sem nome ou e-mail cadastrado." };

  return { ok: true, value: responsible };
}

export async function bulkAssignResponsibleAction(
  _: BulkAssignResponsibleState,
  formData: FormData,
): Promise<BulkAssignResponsibleState> {
  const parsed = parseBulkAssignPayload(formData);
  if (!parsed.ok) return parsed.state;

  if (parsed.data.mode === "selected" && parsed.data.sentenceIds.length === 0) {
    return bulkAssignState(false, "Selecione pelo menos um caso elegivel.", 0, 0);
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return bulkAssignState(false, "Modo demonstracao: conecte o Supabase para atribuir responsaveis em lote.", 0, 0);
  }

  const currentProfile = await requireManagerProfile();
  if (!currentProfile) return bulkAssignState(false, "Apenas administradores e gestores ativos podem atribuir responsaveis.", 0, 0);
  if (parsed.data.mode === "selected" && parsed.data.sentenceIds.some((sentenceId) => !eventIdSchema.safeParse(sentenceId).success)) {
    return bulkAssignState(false, "Revise os casos selecionados para atribuicao.", 0, 0);
  }

  const target = await resolveBulkTargetResponsible(supabase, parsed.data.targetProfileId);
  if (!target.ok) return target.state;

  const result = await applyBulkResponsibleAssignment(supabase, parsed.data, target.responsible);
  if (!result.ok) return result.state;

  if (result.updated > 0) revalidateBulkAssignmentPaths();

  const action = target.responsible ? "atribuido" : "removido";
  return bulkAssignState(
    true,
    `Responsavel ${action} em ${result.updated} caso(s). ${result.skipped} caso(s) ignorado(s).`,
    result.updated,
    result.skipped,
  );
}

export async function createOperatorUserAction(_: CreateOperatorUserState, formData: FormData): Promise<CreateOperatorUserState> {
  const parsed = operatorUserSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Revise os campos para criar o operador.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return {
      ok: false,
      message: "Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para criar usuÃ¡rios no Supabase.",
    };
  }

  const currentProfile = await requireManagerProfile();
  if (!currentProfile) return { ok: false, message: "Apenas administradores e gestores ativos podem criar operadores." };

  const { email, fullName, password } = parsed.data;
  const { data: existingProfile, error: profileLookupError } = await admin
    .from("profiles")
    .select("id,email")
    .eq("email", email)
    .maybeSingle();

  if (profileLookupError) return { ok: false, message: profileLookupError.message };
  if (existingProfile) return { ok: false, message: "JÃ¡ existe um perfil cadastrado com este e-mail." };

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createError || !created.user) {
    return { ok: false, message: createError?.message ?? "NÃ£o foi possÃ­vel criar o usuÃ¡rio no Auth." };
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: created.user.id,
    email,
    full_name: fullName,
    role: "operador" satisfies AppRole,
    active: true,
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, message: profileError.message };
  }

  revalidatePath("/configuracoes");
  return { ok: true, message: `Operador ${fullName} criado. Ele jÃ¡ pode entrar com o e-mail e a senha temporÃ¡ria.` };
}

async function ensureInitialAdmin(email: string) {
  const initialAdminEmail = process.env.INITIAL_ADMIN_EMAIL;
  const admin = createSupabaseAdminClient();
  if (!initialAdminEmail || !admin || email.toLowerCase() !== initialAdminEmail.toLowerCase()) return;

  const {
    data: { users },
  } = await admin.auth.admin.listUsers();
  const user = users.find((item) => item.email?.toLowerCase() === email.toLowerCase());
  if (!user) return;

  await admin.from("profiles").upsert({
    id: user.id,
    email,
    full_name: user.user_metadata?.full_name ?? email.split("@")[0],
    role: "admin",
    active: true,
  });
}

async function requireManagerProfile() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,role,active")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (error || !data || !data.active) return null;
  if (data.role !== "admin" && data.role !== "gestor") return null;

  return data;
}

type ParsedBulkAssignPayload =
  | { ok: true; data: z.infer<typeof bulkAssignSchema> }
  | { ok: false; state: BulkAssignResponsibleState };

type BulkAssignmentResult =
  | { ok: true; updated: number; skipped: number }
  | { ok: false; state: BulkAssignResponsibleState };

type BulkTargetResponsible =
  | { ok: true; responsible: string | null }
  | { ok: false; state: BulkAssignResponsibleState };

type BulkQueryBuilder<T> = {
  eq: (column: string, value: string) => T;
  in: (column: string, values: string[]) => T;
  or: (filters: string) => T;
};

function parseBulkAssignPayload(formData: FormData): ParsedBulkAssignPayload {
  const sentenceIds = [...new Set(
    formData
      .getAll("sentenceIds")
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )];

  const parsed = bulkAssignSchema.safeParse({
    stage: formData.get("stage"),
    mode: formData.get("mode"),
    statusMode: formData.get("statusMode"),
    query: String(formData.get("query") ?? ""),
    responsible: String(formData.get("responsible") ?? ""),
    targetProfileId: formData.get("targetProfileId"),
    sentenceIds,
  });

  if (!parsed.success) return bulkAssignFailure("Revise os dados da atribuicao em lote.", 0, 0);
  return { ok: true, data: parsed.data };
}

async function resolveBulkTargetResponsible(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  targetProfileId: string,
): Promise<BulkTargetResponsible> {
  if (targetProfileId === noResponsibleValue) return { ok: true, responsible: null };

  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name")
    .eq("id", targetProfileId)
    .eq("active", true)
    .maybeSingle();

  if (error) return bulkAssignFailure(error.message, 0, 0);
  if (!data) return bulkAssignFailure("Responsavel ativo nao encontrado.", 0, 0);

  const responsible = String(data.full_name || data.email || "").trim();
  if (!responsible) return bulkAssignFailure("Responsavel ativo sem nome ou e-mail cadastrado.", 0, 0);

  return { ok: true, responsible };
}

async function applyBulkResponsibleAssignment(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  payload: z.infer<typeof bulkAssignSchema>,
  responsible: string | null,
): Promise<BulkAssignmentResult> {
  const columns = stageAssignmentColumns(payload.stage);
  const nextStatus = responsible ? "EM ANDAMENTO" : "ESTOQUE";
  const updatePayload = {
    [columns.responsible]: responsible,
    [columns.status]: nextStatus,
  };

  if (payload.mode === "selected") {
    let request = supabase
      .from("sentences")
      .update(updatePayload)
      .in("id", payload.sentenceIds)
      .in(columns.status, ["ESTOQUE", "EM ANDAMENTO"]);

    if (payload.stage === "QUALIDADE") request = request.eq("cumprimento_status", "ENTREGUE");

    const { data, error } = await request.select("id");
    if (error) return bulkAssignFailure(error.message, 0, 0);

    const updated = data?.length ?? 0;
    return { ok: true, updated, skipped: Math.max(0, payload.sentenceIds.length - updated) };
  }

  const total = await countBulkFilteredSentences(supabase, payload.stage, payload.statusMode, payload.query, payload.responsible);
  if (!total.ok) return total;

  const eligibleStatuses = eligibleStatusesForFilter(payload.statusMode);
  if (eligibleStatuses.length === 0) return { ok: true, updated: 0, skipped: total.count };

  let request = supabase
    .from("sentences")
    .update(updatePayload)
    .in(columns.status, eligibleStatuses);

  request = applyBulkQueueFilters(request, payload.stage, payload.statusMode, payload.query, payload.responsible, columns.status);

  const { data, error } = await request.select("id");
  if (error) return bulkAssignFailure(error.message, 0, 0);

  const updated = data?.length ?? 0;
  return { ok: true, updated, skipped: Math.max(0, total.count - updated) };
}

async function countBulkFilteredSentences(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  stage: WorkflowStage,
  statusMode: QueueStatusMode,
  query: string | undefined,
  responsible: string | undefined,
): Promise<{ ok: true; count: number } | { ok: false; state: BulkAssignResponsibleState }> {
  const { status } = stageAssignmentColumns(stage);
  let request = supabase.from("sentences").select("id", { count: "exact", head: true });
  request = applyBulkQueueFilters(request, stage, statusMode, query, responsible, status);

  const { count, error } = await request;
  if (error) return bulkAssignFailure(error.message, 0, 0);
  return { ok: true, count: count ?? 0 };
}

function applyBulkQueueFilters<T extends BulkQueryBuilder<T>>(
  request: T,
  stage: WorkflowStage,
  statusMode: QueueStatusMode,
  query: string | undefined,
  responsible: string | undefined,
  statusColumn: "cumprimento_status" | "qualidade_status",
) {
  let scoped = request;

  if (stage === "QUALIDADE") scoped = scoped.eq("cumprimento_status", "ENTREGUE");

  if (statusMode !== "ALL") {
    scoped = scoped.eq(statusColumn, statusMode);
  }

  const term = sanitizeBulkSearchTerm(query);
  if (term) scoped = scoped.or(`processo.ilike.%${term}%,autor.ilike.%${term}%,cpf_cnpj.ilike.%${term}%,uc.ilike.%${term}%`);

  const responsibleFilter = responsible?.trim();
  if (responsibleFilter && responsibleFilter !== "ALL") {
    scoped = scoped.eq(stageAssignmentColumns(stage).responsible, responsibleFilter);
  }

  return scoped;
}

function eligibleStatusesForFilter(statusMode: QueueStatusMode) {
  if (statusMode === "EM ANDAMENTO") return ["EM ANDAMENTO"];
  if (statusMode === "ESTOQUE") return ["ESTOQUE"];
  if (statusMode === "PENDENTE" || statusMode === "ENTREGUE") return [];
  return ["ESTOQUE", "EM ANDAMENTO"];
}

function stageAssignmentColumns(stage: WorkflowStage) {
  return stage === "CUMPRIMENTO"
    ? { responsible: "responsavel_cumprimento" as const, status: "cumprimento_status" as const }
    : { responsible: "responsavel_qualidade" as const, status: "qualidade_status" as const };
}

function sanitizeBulkSearchTerm(query: string | undefined) {
  return query?.replace(/[%(),]/g, " ").trim();
}

function revalidateBulkAssignmentPaths() {
  revalidatePath("/sentencas/[id]", "page");
  revalidatePath("/dashboard");
  revalidatePath("/fila");
  revalidatePath("/cumprimento");
  revalidatePath("/qualidade");
}

function bulkAssignState(ok: boolean, message: string, updated: number, skipped: number): BulkAssignResponsibleState {
  return { ok, message, updated, skipped };
}

function bulkAssignFailure(message: string, updated: number, skipped: number) {
  return { ok: false as const, state: bulkAssignState(false, message, updated, skipped) };
}
