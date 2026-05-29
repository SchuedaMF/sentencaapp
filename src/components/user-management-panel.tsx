"use client";

import { useActionState, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  CircleOff,
  KeyRound,
  Loader2,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  UserCog,
  UserPlus,
  X,
} from "lucide-react";
import {
  changeOwnPasswordAction,
  createManagedUserAction,
  resetManagedUserPasswordAction,
  setManagedUserActiveAction,
  updateManagedUserAction,
  type ChangeOwnPasswordState,
  type CreateManagedUserState,
  type ManagedUserStatusState,
  type ResetManagedUserPasswordState,
  type UpdateManagedUserState,
} from "@/app/actions";
import { initials } from "@/lib/normalization";
import type { AppRole, ManagedUser, Profile } from "@/lib/types";

type UserManagementPanelProps = {
  profile: Profile;
  users: ManagedUser[];
  canManageUsers: boolean;
};

type UserModal =
  | { kind: "create" }
  | { kind: "edit"; user: ManagedUser }
  | { kind: "own-password" }
  | { kind: "reset-password"; user: ManagedUser }
  | { kind: "status"; user: ManagedUser; active: boolean }
  | null;

const initialState = {
  ok: false,
  message: "",
};

const roleOptions: Array<{ value: AppRole; label: string }> = [
  { value: "admin", label: "Admin" },
  { value: "gestor", label: "Gestor" },
  { value: "operador", label: "Operador" },
  { value: "analista", label: "Analista" },
];

export function UserManagementPanel({ profile, users, canManageUsers }: UserManagementPanelProps) {
  const [modal, setModal] = useState<UserModal>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<AppRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return users.filter((user) => {
      const matchesQuery = !normalizedQuery
        || `${user.full_name ?? ""} ${user.email}`.toLowerCase().includes(normalizedQuery);
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const matchesStatus = statusFilter === "all"
        || (statusFilter === "active" ? user.active : !user.active);

      return matchesQuery && matchesRole && matchesStatus;
    });
  }, [query, roleFilter, statusFilter, users]);

  const activeCount = users.filter((user) => user.active).length;
  const inactiveCount = users.length - activeCount;
  const currentDisplayName = profile.full_name?.trim() || profile.email;

  return (
    <div className="grid gap-5">
      <section className="border border-zinc-800 bg-[#1d1e1c] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-sky-600 text-base font-bold text-white">
              {initials(currentDisplayName)}
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">Minha conta</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-300">
                <span className="font-semibold text-zinc-100">{currentDisplayName}</span>
                <span className="font-mono text-xs text-zinc-400">{profile.email}</span>
                <RoleBadge role={profile.role} />
                <StatusBadge active={profile.active} />
              </div>
            </div>
          </div>
          <button
            className="inline-flex h-10 w-fit items-center gap-2 rounded-md border border-zinc-700 px-3 text-sm font-semibold text-zinc-100 hover:border-sky-500 hover:bg-sky-500/10"
            onClick={() => setModal({ kind: "own-password" })}
            type="button"
          >
            <KeyRound className="h-4 w-4" />
            Alterar minha senha
          </button>
        </div>
      </section>

      {canManageUsers ? (
        <section className="overflow-hidden border border-zinc-800 bg-[#1d1e1c]">
          <div className="flex flex-col gap-4 border-b border-zinc-800 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Usuarios cadastrados</h2>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-400">
                <span>{users.length} total</span>
                <span>{activeCount} ativos</span>
                <span>{inactiveCount} inativos</span>
              </div>
            </div>
            <button
              className="inline-flex h-10 w-fit items-center gap-2 rounded-md bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-500"
              onClick={() => setModal({ kind: "create" })}
              type="button"
            >
              <UserPlus className="h-4 w-4" />
              Adicionar usuario
            </button>
          </div>

          <div className="grid gap-3 border-b border-zinc-800 p-4 lg:grid-cols-[minmax(260px,1fr)_180px_180px]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 pl-9 pr-3 text-sm outline-none focus:border-sky-500"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por nome ou e-mail"
                value={query}
              />
            </label>
            <select
              className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm outline-none [color-scheme:dark] focus:border-sky-500"
              onChange={(event) => setRoleFilter(event.target.value as AppRole | "all")}
              value={roleFilter}
            >
              <option value="all">Todos os perfis</option>
              {roleOptions.map((role) => (
                <option key={role.value} value={role.value}>{role.label}</option>
              ))}
            </select>
            <select
              className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm outline-none [color-scheme:dark] focus:border-sky-500"
              onChange={(event) => setStatusFilter(event.target.value as "all" | "active" | "inactive")}
              value={statusFilter}
            >
              <option value="all">Todos os status</option>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] table-fixed text-left text-sm">
              <thead className="bg-[#222321] text-xs uppercase text-zinc-300">
                <tr className="[&>th]:border-b [&>th]:border-r [&>th]:border-zinc-800 [&>th]:px-4 [&>th]:py-3">
                  <th className="w-[220px]">Nome</th>
                  <th>E-mail</th>
                  <th className="w-[130px]">Perfil</th>
                  <th className="w-[115px]">Status</th>
                  <th className="w-[140px]">Criado</th>
                  <th className="w-[140px]">Atualizado</th>
                  <th className="w-[170px]">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {filteredUsers.map((user) => (
                  <tr className="align-middle hover:bg-zinc-900/45" key={user.id}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-zinc-100">{user.full_name ?? "-"}</div>
                      {user.id === profile.id ? <div className="mt-1 text-xs text-sky-200">Voce</div> : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-300">{user.email}</td>
                    <td className="px-4 py-3"><RoleBadge role={user.role} /></td>
                    <td className="px-4 py-3"><StatusBadge active={user.active} /></td>
                    <td className="px-4 py-3 text-xs text-zinc-400">{formatDateTime(user.created_at)}</td>
                    <td className="px-4 py-3 text-xs text-zinc-400">{formatDateTime(user.updated_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <IconButton
                          disabled={!canEditUser(profile, user)}
                          label="Editar usuario"
                          onClick={() => setModal({ kind: "edit", user })}
                        >
                          <Pencil className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          disabled={!canResetPassword(profile, user)}
                          label="Redefinir senha"
                          onClick={() => setModal({ kind: "reset-password", user })}
                        >
                          <KeyRound className="h-4 w-4" />
                        </IconButton>
                        {user.active ? (
                          <IconButton
                            disabled={!canToggleStatus(profile, user)}
                            label="Excluir usuario"
                            onClick={() => setModal({ kind: "status", user, active: false })}
                            tone="danger"
                          >
                            <Trash2 className="h-4 w-4" />
                          </IconButton>
                        ) : (
                          <IconButton
                            disabled={!canToggleStatus(profile, user)}
                            label="Reativar usuario"
                            onClick={() => setModal({ kind: "status", user, active: true })}
                            tone="success"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </IconButton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredUsers.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-400">Nenhum usuario encontrado.</div>
          ) : null}
        </section>
      ) : (
        <section className="border border-zinc-800 bg-[#1d1e1c] p-5 text-sm text-zinc-300">
          Seu perfil atual nao tem permissao para gerenciar usuarios.
        </section>
      )}

      {modal?.kind === "create" ? <CreateUserModal currentRole={profile.role} onClose={() => setModal(null)} /> : null}
      {modal?.kind === "edit" ? <EditUserModal currentRole={profile.role} onClose={() => setModal(null)} user={modal.user} /> : null}
      {modal?.kind === "own-password" ? <OwnPasswordModal onClose={() => setModal(null)} /> : null}
      {modal?.kind === "reset-password" ? <ResetPasswordModal onClose={() => setModal(null)} user={modal.user} /> : null}
      {modal?.kind === "status" ? (
        <StatusModal active={modal.active} onClose={() => setModal(null)} user={modal.user} />
      ) : null}
    </div>
  );
}

function CreateUserModal({ currentRole, onClose }: { currentRole: AppRole; onClose: () => void }) {
  const [state, action, pending] = useActionState<CreateManagedUserState, FormData>(createManagedUserAction, initialState);
  useRefreshAndClose(state.ok, onClose);

  return (
    <ModalFrame icon={<UserPlus className="h-5 w-5 text-sky-300" />} onClose={onClose} title="Adicionar usuario">
      <form action={action} className="grid gap-4">
        <UserFields roleOptions={availableRoleOptions(currentRole)} state={state} />
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Senha temporaria</span>
          <input className={inputClassName} minLength={8} name="password" required type="password" />
          <FieldError errors={state.errors?.password} />
        </label>
        <FormMessage state={state} />
        <FormFooter onClose={onClose} pending={pending} submitLabel="Criar usuario" />
      </form>
    </ModalFrame>
  );
}

function EditUserModal({ currentRole, onClose, user }: { currentRole: AppRole; onClose: () => void; user: ManagedUser }) {
  const [state, action, pending] = useActionState<UpdateManagedUserState, FormData>(updateManagedUserAction, initialState);
  useRefreshAndClose(state.ok, onClose);

  return (
    <ModalFrame icon={<UserCog className="h-5 w-5 text-sky-300" />} onClose={onClose} title="Editar usuario">
      <form action={action} className="grid gap-4">
        <input name="userId" type="hidden" value={user.id} />
        <UserFields roleOptions={availableRoleOptions(currentRole)} state={state} user={user} />
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Status</span>
          <select className={inputClassName} defaultValue={String(user.active)} name="active">
            <option value="true">Ativo</option>
            <option value="false">Inativo</option>
          </select>
          <FieldError errors={state.errors?.active} />
        </label>
        <FormMessage state={state} />
        <FormFooter onClose={onClose} pending={pending} submitLabel="Salvar alteracoes" />
      </form>
    </ModalFrame>
  );
}

function OwnPasswordModal({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState<ChangeOwnPasswordState, FormData>(changeOwnPasswordAction, initialState);
  useRefreshAndClose(state.ok, onClose);

  return (
    <ModalFrame icon={<KeyRound className="h-5 w-5 text-sky-300" />} onClose={onClose} title="Alterar minha senha">
      <form action={action} className="grid gap-4">
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Senha atual</span>
          <input className={inputClassName} name="currentPassword" required type="password" />
          <FieldError errors={state.errors?.currentPassword} />
        </label>
        <PasswordFields state={state} />
        <FormMessage state={state} />
        <FormFooter onClose={onClose} pending={pending} submitLabel="Alterar senha" />
      </form>
    </ModalFrame>
  );
}

function ResetPasswordModal({ onClose, user }: { onClose: () => void; user: ManagedUser }) {
  const [state, action, pending] = useActionState<ResetManagedUserPasswordState, FormData>(resetManagedUserPasswordAction, initialState);
  useRefreshAndClose(state.ok, onClose);

  return (
    <ModalFrame icon={<KeyRound className="h-5 w-5 text-sky-300" />} onClose={onClose} title="Redefinir senha">
      <form action={action} className="grid gap-4">
        <input name="userId" type="hidden" value={user.id} />
        <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-sm">
          <div className="font-semibold text-zinc-100">{user.full_name ?? user.email}</div>
          <div className="font-mono text-xs text-zinc-400">{user.email}</div>
        </div>
        <PasswordFields state={state} />
        <FormMessage state={state} />
        <FormFooter onClose={onClose} pending={pending} submitLabel="Redefinir senha" />
      </form>
    </ModalFrame>
  );
}

function StatusModal({ active, onClose, user }: { active: boolean; onClose: () => void; user: ManagedUser }) {
  const [state, action, pending] = useActionState<ManagedUserStatusState, FormData>(setManagedUserActiveAction, initialState);
  useRefreshAndClose(state.ok, onClose);

  return (
    <ModalFrame
      icon={active ? <RotateCcw className="h-5 w-5 text-emerald-300" /> : <Trash2 className="h-5 w-5 text-red-300" />}
      onClose={onClose}
      title={active ? "Reativar usuario" : "Excluir usuario"}
    >
      <form action={action} className="grid gap-4">
        <input name="userId" type="hidden" value={user.id} />
        <input name="active" type="hidden" value={String(active)} />
        <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-sm">
          <div className="font-semibold text-zinc-100">{user.full_name ?? user.email}</div>
          <div className="font-mono text-xs text-zinc-400">{user.email}</div>
        </div>
        <FormMessage state={state} />
        <FormFooter onClose={onClose} pending={pending} submitLabel={active ? "Reativar" : "Excluir"} tone={active ? "success" : "danger"} />
      </form>
    </ModalFrame>
  );
}

function UserFields({
  roleOptions: options,
  state,
  user,
}: {
  roleOptions: Array<{ value: AppRole; label: string }>;
  state: CreateManagedUserState | UpdateManagedUserState;
  user?: ManagedUser;
}) {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Nome</span>
          <input className={inputClassName} defaultValue={user?.full_name ?? ""} minLength={2} name="fullName" required />
          <FieldError errors={state.errors?.fullName} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">E-mail</span>
          <input className={inputClassName} defaultValue={user?.email ?? ""} name="email" required type="email" />
          <FieldError errors={state.errors?.email} />
        </label>
      </div>
      <label>
        <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Perfil</span>
        <select className={inputClassName} defaultValue={user?.role ?? "operador"} name="role">
          {options.map((role) => (
            <option key={role.value} value={role.value}>{role.label}</option>
          ))}
        </select>
        <FieldError errors={state.errors?.role} />
      </label>
    </>
  );
}

function PasswordFields({ state }: { state: ChangeOwnPasswordState | ResetManagedUserPasswordState }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <label>
        <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Nova senha</span>
        <input className={inputClassName} minLength={8} name="password" required type="password" />
        <FieldError errors={state.errors?.password} />
      </label>
      <label>
        <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Confirmar senha</span>
        <input className={inputClassName} minLength={8} name="passwordConfirm" required type="password" />
        <FieldError errors={state.errors?.passwordConfirm} />
      </label>
    </div>
  );
}

function ModalFrame({ children, icon, onClose, title }: { children: ReactNode; icon: ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div aria-modal="true" className="w-full max-w-xl rounded-md border border-zinc-700 bg-[#1d1e1c] shadow-2xl" role="dialog">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2">
            {icon}
            <h3 className="text-lg font-semibold">{title}</h3>
          </div>
          <button className="grid h-9 w-9 place-items-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" onClick={onClose} title="Fechar" type="button">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function FormFooter({
  onClose,
  pending,
  submitLabel,
  tone = "primary",
}: {
  onClose: () => void;
  pending: boolean;
  submitLabel: string;
  tone?: "primary" | "danger" | "success";
}) {
  const submitClassName = {
    primary: "bg-sky-600 text-white hover:bg-sky-500",
    danger: "bg-red-700 text-white hover:bg-red-600",
    success: "bg-emerald-700 text-white hover:bg-emerald-600",
  }[tone];

  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      <button className="h-10 rounded-md border border-zinc-700 px-4 text-sm font-semibold text-zinc-200 hover:bg-zinc-800" onClick={onClose} type="button">
        Cancelar
      </button>
      <button className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${submitClassName}`} disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {submitLabel}
      </button>
    </div>
  );
}

function FormMessage({ state }: { state: { ok: boolean; message: string } }) {
  if (!state.message) return null;

  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${state.ok ? "border-emerald-700 bg-emerald-950/40 text-emerald-200" : "border-red-800 bg-red-950/40 text-red-200"}`}>
      {state.message}
    </div>
  );
}

function FieldError({ errors }: { errors?: string[] }) {
  return errors?.[0] ? <span className="mt-1 block text-xs text-red-300">{errors[0]}</span> : null;
}

function IconButton({
  children,
  disabled,
  label,
  onClick,
  tone = "neutral",
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  tone?: "neutral" | "danger" | "success";
}) {
  const toneClassName = {
    neutral: "text-zinc-300 hover:border-sky-500 hover:bg-sky-500/10 hover:text-sky-100",
    danger: "text-red-200 hover:border-red-500 hover:bg-red-500/10",
    success: "text-emerald-200 hover:border-emerald-500 hover:bg-emerald-500/10",
  }[tone];

  return (
    <button
      aria-label={label}
      className={`grid h-9 w-9 place-items-center rounded-md border border-zinc-700 disabled:cursor-not-allowed disabled:opacity-35 ${toneClassName}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function RoleBadge({ role }: { role: AppRole }) {
  return (
    <span className="inline-flex rounded px-2 py-1 text-xs font-semibold ring-1 ring-inset ring-sky-500/30 bg-sky-500/10 text-sky-100">
      {roleLabel(role)}
    </span>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold ${active ? "bg-emerald-950 text-emerald-200" : "bg-zinc-800 text-zinc-400"}`}>
      {active ? <CheckCircle2 className="h-3 w-3" /> : <CircleOff className="h-3 w-3" />}
      {active ? "Ativo" : "Inativo"}
    </span>
  );
}

function useRefreshAndClose(ok: boolean, onClose: () => void) {
  const router = useRouter();

  useEffect(() => {
    if (!ok) return;

    router.refresh();
    const timeout = window.setTimeout(onClose, 700);
    return () => window.clearTimeout(timeout);
  }, [ok, onClose, router]);
}

function availableRoleOptions(currentRole: AppRole) {
  if (currentRole === "admin") return roleOptions;
  return roleOptions.filter((role) => role.value === "operador" || role.value === "analista");
}

function canEditUser(profile: Profile, user: ManagedUser) {
  if (profile.role === "admin") return true;
  if (profile.role !== "gestor") return false;
  return user.role === "operador" || user.role === "analista";
}

function canResetPassword(profile: Profile, user: ManagedUser) {
  return profile.role === "admin" && profile.id !== user.id;
}

function canToggleStatus(profile: Profile, user: ManagedUser) {
  return profile.id !== user.id && canEditUser(profile, user);
}

function roleLabel(role: AppRole) {
  return roleOptions.find((item) => item.value === role)?.label ?? role;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

const inputClassName = "h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm outline-none [color-scheme:dark] focus:border-sky-500";
