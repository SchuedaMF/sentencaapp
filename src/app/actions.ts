"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assignableProfilesCacheTag } from "@/lib/assignable-profiles-cache";
import { canonicalizeEventPendencia, resolveEventAreaInput } from "@/lib/event-taxonomy";
import { canCreateOwnEvents, canManageOperationalData } from "@/lib/permissions";
import { parseQueuePendencia, queueMissingPendenciaValue } from "@/lib/queue";
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

const appRoleSchema = z.enum(["admin", "gestor", "operador", "analista"]);
const managerEditableRoles: AppRole[] = ["operador", "analista"];

const managedUserCreateSchema = z.object({
  fullName: z.string().trim().min(2, "Informe o nome do usuario.").max(120, "Use um nome menor."),
  email: z.string().trim().toLowerCase().email("Informe um e-mail vÃ¡lido."),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres.").max(72, "Use uma senha menor."),
  role: appRoleSchema.default("operador"),
});

const operatorUserSchema = managedUserCreateSchema.omit({ role: true });
const analystRoleSchema = z.enum(["operador", "analista"]).default("operador");

const managedUserUpdateSchema = z.object({
  userId: z.string().uuid("Usuario invalido."),
  fullName: z.string().trim().min(2, "Informe o nome do usuario.").max(120, "Use um nome menor."),
  email: z.string().trim().toLowerCase().email("Informe um e-mail valido."),
  role: appRoleSchema,
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

const managedUserStatusSchema = z.object({
  userId: z.string().uuid("Usuario invalido."),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

const ownPasswordSchema = z.object({
  currentPassword: z.string().min(1, "Informe a senha atual."),
  password: z.string().min(8, "A nova senha precisa ter pelo menos 8 caracteres.").max(72, "Use uma senha menor."),
  passwordConfirm: z.string().min(1, "Confirme a nova senha."),
}).refine((data) => data.password === data.passwordConfirm, {
  message: "As senhas nao conferem.",
  path: ["passwordConfirm"],
});

const adminPasswordResetSchema = z.object({
  userId: z.string().uuid("Usuario invalido."),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres.").max(72, "Use uma senha menor."),
  passwordConfirm: z.string().min(1, "Confirme a nova senha."),
}).refine((data) => data.password === data.passwordConfirm, {
  message: "As senhas nao conferem.",
  path: ["passwordConfirm"],
});

const bulkAssignSchema = z.object({
  stage: z.enum(["CUMPRIMENTO", "QUALIDADE"]),
  mode: z.enum(["selected", "filtered"]),
  statusMode: z.enum(["ALL", "ENTREGUE", "PENDENTE", "EM ANDAMENTO", "ESTOQUE"]),
  pendencia: z.string().trim().optional(),
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

type EventActor = {
  userId: string | null;
  isManager: boolean;
  canWriteOwnEvents: boolean;
};

type ManagedUserActionField =
  | "userId"
  | "fullName"
  | "email"
  | "password"
  | "passwordConfirm"
  | "currentPassword"
  | "role"
  | "active";

export type ManagedUserActionState = {
  ok: boolean;
  message: string;
  errors?: Partial<Record<ManagedUserActionField, string[]>>;
};

export type CreateManagedUserState = ManagedUserActionState;
export type CreateOperatorUserState = ManagedUserActionState;
export type UpdateManagedUserState = ManagedUserActionState;
export type ManagedUserStatusState = ManagedUserActionState;
export type ChangeOwnPasswordState = ManagedUserActionState;
export type ResetManagedUserPasswordState = ManagedUserActionState;

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
  if (!auth.user) return { ok: false, message: "Sessão expirada. Entre novamente para registrar eventos." };

  const actor = await getEventActor(supabase);
  if (!actor.canWriteOwnEvents) return { ok: false, message: "Analistas possuem acesso somente para consulta e exportacao." };

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
      pendencia: payload.tipoEvento === "PENDENTE" ? payload.pendencia || null : null,
      area: payload.area || null,
      obs: payload.obs || null,
      created_by: auth.user.id,
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
  const actor = await getEventActor(supabase);
  if (!actor.userId) return { ok: false, message: "Sessão expirada. Entre novamente para atualizar eventos." };

  const { data: existingEvent, error: lookupError } = await supabase
    .from("sentence_events")
    .select("id,sentence_id,responsavel,created_by")
    .eq("id", eventId)
    .maybeSingle();

  if (lookupError) return { ok: false, message: lookupError.message };
  if (!existingEvent) return { ok: false, message: "Evento não encontrado." };
  if (existingEvent.sentence_id !== payload.sentenceId) return { ok: false, message: "Evento não pertence a esta sentença." };
  if (!canMutateEvent(actor, existingEvent)) return { ok: false, message: "Você só pode editar eventos criados por você." };

  const responsible = await resolveEventResponsible(supabase, payload.responsavelProfileId, existingEvent.responsavel);
  if (!responsible.ok) return { ok: false, message: responsible.message };

  const { data: updatedEvent, error } = await supabase
    .from("sentence_events")
    .update({
      etapa: payload.etapa,
      tipo_evento: payload.tipoEvento,
      data_evento: payload.dataEvento,
      responsavel: responsible.value,
      pendencia: payload.tipoEvento === "PENDENTE" ? payload.pendencia || null : null,
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

  const actor = await getEventActor(supabase);
  if (!actor.userId) return { ok: false, message: "Sessão expirada. Entre novamente para excluir eventos." };

  const { data: existingEvent, error: lookupError } = await supabase
    .from("sentence_events")
    .select("id,sentence_id,created_by")
    .eq("id", parsedEventId.data)
    .maybeSingle();

  if (lookupError) return { ok: false, message: lookupError.message };
  if (!existingEvent) return { ok: false, message: "Evento não encontrado." };
  if (!canMutateEvent(actor, existingEvent)) return { ok: false, message: "Você só pode excluir eventos criados por você." };

  const { data: deletedEvent, error } = await supabase
    .from("sentence_events")
    .delete()
    .eq("id", parsedEventId.data)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, message: error.message };
  if (!deletedEvent) return { ok: false, message: "Não foi possível excluir o evento." };

  revalidateSentenceEventPaths(existingEvent.sentence_id);
  return { ok: true, message: "Evento excluído com sucesso." };
}

async function getEventActor(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
): Promise<EventActor> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { userId: null, isManager: false, canWriteOwnEvents: false };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role,active")
    .eq("id", auth.user.id)
    .maybeSingle();

  const actorProfile = {
    role: (profile?.role ?? "operador") as AppRole,
    active: profile?.active ?? true,
  };

  return {
    userId: auth.user.id,
    isManager: canManageOperationalData(actorProfile),
    canWriteOwnEvents: canCreateOwnEvents(actorProfile),
  };
}

function canMutateEvent(actor: EventActor, event: { created_by?: string | null }) {
  return actor.isManager || (actor.canWriteOwnEvents && Boolean(actor.userId && event.created_by === actor.userId));
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

  const isPendingEvent = parsed.data.tipoEvento === "PENDENTE";
  const rawPendencia = isPendingEvent ? parsed.data.pendencia?.trim() ?? "" : "";
  const pendencia = rawPendencia ? canonicalizeEventPendencia(rawPendencia) : null;
  if (isPendingEvent && !rawPendencia) return { ok: false, message: "Selecione uma pendência para eventos PENDENTE." };
  if (isPendingEvent && rawPendencia && !pendencia) return { ok: false, message: "Selecione uma pendência válida." };

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
  const parsedRole = analystRoleSchema.safeParse(formData.get("role") || "operador");

  if (!parsed.success || !parsedRole.success) {
    return {
      ok: false,
      message: "Revise os campos para criar o perfil.",
      errors: {
        ...(parsed.success ? {} : parsed.error.flatten().fieldErrors),
        ...(parsedRole.success ? {} : { role: ["Perfil invalido."] }),
      },
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
  if (!currentProfile) return { ok: false, message: "Apenas administradores e gestores ativos podem criar perfis." };

  const { email, fullName, password } = parsed.data;
  const role = parsedRole.data;
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
    role: role satisfies AppRole,
    active: true,
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, message: profileError.message };
  }

  updateTag(assignableProfilesCacheTag);
  revalidatePath("/configuracoes");
  revalidatePath("/fila");
  return { ok: true, message: `Perfil ${fullName} criado como ${role}. Ele ja pode entrar com o e-mail e a senha temporaria.` };
}

export async function createManagedUserAction(_: CreateManagedUserState, formData: FormData): Promise<CreateManagedUserState> {
  const parsed = managedUserCreateSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role") || "operador",
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Revise os campos para criar o usuario.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: "Configure a chave de servico do Supabase para criar usuarios." };

  const currentProfile = await requireManagerProfile();
  if (!currentProfile) return { ok: false, message: "Apenas administradores e gestores ativos podem criar usuarios." };
  if (!canCreateManagedRole(currentProfile.role as AppRole, parsed.data.role)) {
    return { ok: false, message: "Seu perfil nao pode criar este tipo de usuario.", errors: { role: ["Perfil nao permitido."] } };
  }

  const { email, fullName, password, role } = parsed.data;
  const { data: existingProfile, error: profileLookupError } = await admin
    .from("profiles")
    .select("id,email")
    .eq("email", email)
    .maybeSingle();

  if (profileLookupError) return { ok: false, message: profileLookupError.message };
  if (existingProfile) return { ok: false, message: "Ja existe um perfil cadastrado com este e-mail." };

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createError || !created.user) {
    return { ok: false, message: createError?.message ?? "Nao foi possivel criar o usuario no Auth." };
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: created.user.id,
    email,
    full_name: fullName,
    role: role satisfies AppRole,
    active: true,
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, message: profileError.message };
  }

  revalidateUserManagementPaths();
  return { ok: true, message: `Perfil ${fullName} criado como ${role}.` };
}

export async function updateManagedUserAction(_: UpdateManagedUserState, formData: FormData): Promise<UpdateManagedUserState> {
  const parsed = managedUserUpdateSchema.safeParse({
    userId: formData.get("userId"),
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    role: formData.get("role"),
    active: formData.get("active"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Revise os campos para atualizar o usuario.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: "Configure a chave de servico do Supabase para editar usuarios." };

  const currentProfile = await requireManagerProfile();
  if (!currentProfile) return { ok: false, message: "Apenas administradores e gestores ativos podem editar usuarios." };

  const target = await getManagedProfileById(parsed.data.userId);
  if (!target) return { ok: false, message: "Usuario nao encontrado." };
  if (!canManageTargetProfile(currentProfile.role as AppRole, target.role as AppRole, parsed.data.role)) {
    return { ok: false, message: "Seu perfil nao pode editar este usuario." };
  }
  if (target.id === currentProfile.id && !parsed.data.active) {
    return { ok: false, message: "Voce nao pode desativar o seu proprio usuario." };
  }

  const adminCheck = await ensureAdminRemainsActive(target, parsed.data.role, parsed.data.active);
  if (!adminCheck.ok) return adminCheck.state;

  const emailChanged = parsed.data.email !== target.email.toLowerCase();
  if (emailChanged) {
    const { data: existingProfile, error: profileLookupError } = await admin
      .from("profiles")
      .select("id,email")
      .eq("email", parsed.data.email)
      .neq("id", target.id)
      .maybeSingle();

    if (profileLookupError) return { ok: false, message: profileLookupError.message };
    if (existingProfile) return { ok: false, message: "Ja existe outro perfil cadastrado com este e-mail." };
  }

  const { error: authError } = await admin.auth.admin.updateUserById(target.id, {
    email: parsed.data.email,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.fullName },
  });

  if (authError) return { ok: false, message: authError.message };

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      email: parsed.data.email,
      full_name: parsed.data.fullName,
      role: parsed.data.role satisfies AppRole,
      active: parsed.data.active,
    })
    .eq("id", target.id);

  if (profileError) return { ok: false, message: profileError.message };

  revalidateUserManagementPaths();
  return { ok: true, message: "Usuario atualizado." };
}

export async function setManagedUserActiveAction(_: ManagedUserStatusState, formData: FormData): Promise<ManagedUserStatusState> {
  const parsed = managedUserStatusSchema.safeParse({
    userId: formData.get("userId"),
    active: formData.get("active"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Revise a alteracao de status.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: "Configure a chave de servico do Supabase para alterar usuarios." };

  const currentProfile = await requireManagerProfile();
  if (!currentProfile) return { ok: false, message: "Apenas administradores e gestores ativos podem alterar usuarios." };

  const target = await getManagedProfileById(parsed.data.userId);
  if (!target) return { ok: false, message: "Usuario nao encontrado." };
  if (!canManageTargetProfile(currentProfile.role as AppRole, target.role as AppRole)) {
    return { ok: false, message: "Seu perfil nao pode alterar este usuario." };
  }
  if (target.id === currentProfile.id && !parsed.data.active) {
    return { ok: false, message: "Voce nao pode desativar o seu proprio usuario." };
  }

  const adminCheck = await ensureAdminRemainsActive(target, target.role as AppRole, parsed.data.active);
  if (!adminCheck.ok) return adminCheck.state;

  const { error } = await admin
    .from("profiles")
    .update({ active: parsed.data.active })
    .eq("id", target.id);

  if (error) return { ok: false, message: error.message };

  revalidateUserManagementPaths();
  return { ok: true, message: parsed.data.active ? "Usuario reativado." : "Usuario desativado." };
}

export async function changeOwnPasswordAction(_: ChangeOwnPasswordState, formData: FormData): Promise<ChangeOwnPasswordState> {
  const parsed = ownPasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Revise os campos para alterar a senha.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, message: "Modo demonstracao: conecte o Supabase para alterar senha." };

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: "Sessao expirada. Entre novamente para alterar a senha." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("active")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (!profile?.active) return { ok: false, message: "Usuario inativo nao pode alterar senha." };

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
    current_password: parsed.data.currentPassword,
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Senha alterada." };
}

export async function resetManagedUserPasswordAction(_: ResetManagedUserPasswordState, formData: FormData): Promise<ResetManagedUserPasswordState> {
  const parsed = adminPasswordResetSchema.safeParse({
    userId: formData.get("userId"),
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Revise os campos para alterar a senha.",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: "Configure a chave de servico do Supabase para redefinir senha." };

  const currentProfile = await requireManagerProfile();
  if (!currentProfile || currentProfile.role !== "admin") {
    return { ok: false, message: "Apenas administradores podem redefinir senha de outros usuarios." };
  }
  if (currentProfile.id === parsed.data.userId) {
    return { ok: false, message: "Use a alteracao da sua propria senha para este usuario." };
  }

  const target = await getManagedProfileById(parsed.data.userId);
  if (!target) return { ok: false, message: "Usuario nao encontrado." };

  const { error } = await admin.auth.admin.updateUserById(target.id, { password: parsed.data.password });
  if (error) return { ok: false, message: error.message };

  return { ok: true, message: "Senha redefinida." };
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

  const { error } = await admin.from("profiles").upsert({
    id: user.id,
    email,
    full_name: user.user_metadata?.full_name ?? email.split("@")[0],
    role: "admin",
    active: true,
  });
  if (!error) updateTag(assignableProfilesCacheTag);
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

type ManagedProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  active: boolean;
};

async function getManagedProfileById(userId: string): Promise<ManagedProfileRow | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const { data, error } = await admin
    .from("profiles")
    .select("id,email,full_name,role,active")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return null;
  return data as ManagedProfileRow;
}

function canCreateManagedRole(actorRole: AppRole, role: AppRole) {
  if (actorRole === "admin") return true;
  if (actorRole === "gestor") return managerEditableRoles.includes(role);
  return false;
}

function canManageTargetProfile(actorRole: AppRole, targetRole: AppRole, nextRole?: AppRole) {
  if (actorRole === "admin") return true;
  if (actorRole !== "gestor") return false;
  if (!managerEditableRoles.includes(targetRole)) return false;
  return nextRole ? managerEditableRoles.includes(nextRole) : true;
}

async function ensureAdminRemainsActive(
  target: ManagedProfileRow,
  nextRole: AppRole,
  nextActive: boolean,
): Promise<{ ok: true } | { ok: false; state: ManagedUserActionState }> {
  if (target.role !== "admin" || !target.active) return { ok: true };
  if (nextRole === "admin" && nextActive) return { ok: true };

  const activeAdmins = await countActiveAdminsExcept(target.id);
  if (activeAdmins > 0) return { ok: true };
  return { ok: false, state: { ok: false, message: "Mantenha pelo menos um admin ativo." } };
}

async function countActiveAdminsExcept(userId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return 0;

  const { count, error } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("active", true)
    .neq("id", userId);

  if (error) return 0;
  return count ?? 0;
}

function revalidateUserManagementPaths() {
  updateTag(assignableProfilesCacheTag);
  revalidatePath("/configuracoes");
  revalidatePath("/fila");
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
  is: (column: string, value: null) => T;
  or: (filters: string) => T;
};

type BulkSentencePendenciaRow = {
  id: string;
  raw_import_payload?: Record<string, unknown> | null;
};

type BulkLatestEventPendenciaRow = {
  id: string;
  sentence_id: string;
  tipo_evento: string | null;
  pendencia: string | null;
  data_evento: string | null;
  created_at: string | null;
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
    pendencia: parseQueuePendencia(String(formData.get("pendencia") ?? "")) ?? "",
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
    [columns.baseStatus]: nextStatus,
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

  const total = await countBulkFilteredSentences(supabase, payload.stage, payload.statusMode, payload.pendencia, payload.query, payload.responsible);
  if (!total.ok) return total;

  const eligibleStatuses = eligibleStatusesForFilter(payload.statusMode);
  if (eligibleStatuses.length === 0) return { ok: true, updated: 0, skipped: total.count };

  let request = supabase
    .from("sentences")
    .update(updatePayload)
    .in(columns.status, eligibleStatuses);

  request = applyBulkQueueFilters(request, payload.stage, payload.statusMode, payload.pendencia, payload.query, payload.responsible, columns.status);

  const { data, error } = await request.select("id");
  if (error) return bulkAssignFailure(error.message, 0, 0);

  const updated = data?.length ?? 0;
  return { ok: true, updated, skipped: Math.max(0, total.count - updated) };
}

async function countBulkFilteredSentences(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  stage: WorkflowStage,
  statusMode: QueueStatusMode,
  pendencia: string | undefined,
  query: string | undefined,
  responsible: string | undefined,
): Promise<{ ok: true; count: number } | { ok: false; state: BulkAssignResponsibleState }> {
  const { status } = stageAssignmentColumns(stage);

  if (statusMode === "PENDENTE" && parseQueuePendencia(pendencia)) {
    return countBulkFilteredSentencesByDerivedPendencia(supabase, stage, statusMode, pendencia, query, responsible);
  }

  let request = supabase.from("sentences").select("id", { count: "exact", head: true });
  request = applyBulkQueueFilters(request, stage, statusMode, pendencia, query, responsible, status);

  const { count, error } = await request;
  if (error) return bulkAssignFailure(error.message, 0, 0);
  return { ok: true, count: count ?? 0 };
}

async function countBulkFilteredSentencesByDerivedPendencia(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  stage: WorkflowStage,
  statusMode: QueueStatusMode,
  pendencia: string | undefined,
  query: string | undefined,
  responsible: string | undefined,
): Promise<{ ok: true; count: number } | { ok: false; state: BulkAssignResponsibleState }> {
  const targetPendencia = parseQueuePendencia(pendencia);
  if (!targetPendencia) return { ok: true, count: 0 };

  const rowsResult = await selectBulkFilteredSentenceRows(supabase, stage, statusMode, query, responsible);
  if (!rowsResult.ok) return { ok: false, state: rowsResult.state };

  const rows = rowsResult.rows;
  const eventPendencias = await getBulkLatestEventPendencias(supabase, rows.map((row) => row.id));
  let count = 0;

  for (const row of rows) {
    const rowPendencia = eventPendencias.get(row.id)
      ?? queueMissingPendenciaValue;
    if (rowPendencia === targetPendencia) count += 1;
  }

  return { ok: true, count };
}

async function selectBulkFilteredSentenceRows(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  stage: WorkflowStage,
  statusMode: QueueStatusMode,
  query: string | undefined,
  responsible: string | undefined,
): Promise<{ ok: true; rows: BulkSentencePendenciaRow[] } | { ok: false; state: BulkAssignResponsibleState }> {
  const { status } = stageAssignmentColumns(stage);
  const pageSize = 1000;
  const limit = 10000;
  const rows: BulkSentencePendenciaRow[] = [];

  for (let from = 0; from < limit; from += pageSize) {
    let request = supabase.from("sentences").select("id,raw_import_payload");
    request = applyBulkQueueFilters(request, stage, statusMode, undefined, query, responsible, status);

    const { data, error } = await request.range(from, Math.min(from + pageSize - 1, limit - 1));
    if (error) return bulkAssignFailure(error.message, 0, 0);

    const pageRows = (data ?? []) as BulkSentencePendenciaRow[];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
  }

  return { ok: true, rows };
}

async function getBulkLatestEventPendencias(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  sentenceIds: string[],
) {
  const pendencias = new Map<string, EventPendingOption>();
  const seen = new Set<string>();
  const uniqueIds = [...new Set(sentenceIds.filter(Boolean))];
  const client = createSupabaseAdminClient() ?? supabase;

  for (let from = 0; from < uniqueIds.length; from += 25) {
    const ids = uniqueIds.slice(from, from + 25);
    if (ids.length === 0) continue;

    const request = client
      .from("sentence_events")
      .select("id,sentence_id,tipo_evento,pendencia,data_evento,created_at,affects_operational_state")
      .in("sentence_id", ids)
      .eq("affects_operational_state", true)
      .order("data_evento", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });

    const initial = await request;
    let data = initial.data as BulkLatestEventPendenciaRow[] | null;
    let error = initial.error;

    if (error && isMissingAffectsOperationalStateError(error)) {
      const fallback = await client
        .from("sentence_events")
        .select("id,sentence_id,tipo_evento,pendencia,data_evento,created_at")
        .in("sentence_id", ids)
        .order("data_evento", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false });

      data = fallback.data as BulkLatestEventPendenciaRow[] | null;
      error = fallback.error;
    }

    if (error) continue;

    for (const row of (data ?? []) as BulkLatestEventPendenciaRow[]) {
      if (seen.has(row.sentence_id)) continue;
      seen.add(row.sentence_id);
      if (row.tipo_evento !== "PENDENTE") continue;

      const pendencia = canonicalizeEventPendencia(row.pendencia);
      if (pendencia) pendencias.set(row.sentence_id, pendencia);
    }
  }

  return pendencias;
}

function isMissingAffectsOperationalStateError(error: { message?: string; code?: string; details?: string } | null | undefined) {
  if (!error) return false;
  if (error.code === "42703") return true;
  const text = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return text.includes("affects_operational_state") && (text.includes("does not exist") || text.includes("schema cache"));
}

function applyBulkQueueFilters<T extends BulkQueryBuilder<T>>(
  request: T,
  stage: WorkflowStage,
  statusMode: QueueStatusMode,
  pendencia: string | undefined,
  query: string | undefined,
  responsible: string | undefined,
  statusColumn: "cumprimento_status" | "qualidade_status",
) {
  let scoped = request;

  if (stage === "QUALIDADE") scoped = scoped.eq("cumprimento_status", "ENTREGUE");

  if (statusMode !== "ALL") {
    scoped = scoped.eq(statusColumn, statusMode);
  }
  scoped = applyBulkPendenciaFilter(scoped, statusMode, pendencia);

  const term = sanitizeBulkSearchTerm(query);
  if (term) scoped = scoped.or(`processo.ilike.%${term}%,autor.ilike.%${term}%,cpf_cnpj.ilike.%${term}%,uc.ilike.%${term}%`);

  const responsibleFilter = responsible?.trim();
  if (responsibleFilter && responsibleFilter !== "ALL") {
    scoped = scoped.eq(stageAssignmentColumns(stage).responsible, responsibleFilter);
  }

  return scoped;
}

function applyBulkPendenciaFilter<T extends BulkQueryBuilder<T>>(
  request: T,
  statusMode: QueueStatusMode,
  rawPendencia: string | undefined,
) {
  if (statusMode !== "PENDENTE") return request;

  const pendencia = parseQueuePendencia(rawPendencia);
  if (!pendencia) return request;
  if (pendencia === queueMissingPendenciaValue) return request.is("pendencia", null);
  return request.eq("pendencia", pendencia);
}

function eligibleStatusesForFilter(statusMode: QueueStatusMode) {
  if (statusMode === "EM ANDAMENTO") return ["EM ANDAMENTO"];
  if (statusMode === "ESTOQUE") return ["ESTOQUE"];
  if (statusMode === "PENDENTE" || statusMode === "ENTREGUE") return [];
  return ["ESTOQUE", "EM ANDAMENTO"];
}

function stageAssignmentColumns(stage: WorkflowStage) {
  return stage === "CUMPRIMENTO"
    ? {
        responsible: "responsavel_cumprimento" as const,
        status: "cumprimento_status" as const,
        baseStatus: "cumprimento_base_status" as const,
      }
    : {
        responsible: "responsavel_qualidade" as const,
        status: "qualidade_status" as const,
        baseStatus: "qualidade_base_status" as const,
      };
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
