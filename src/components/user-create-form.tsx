"use client";

import { useActionState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { createOperatorUserAction, type CreateOperatorUserState } from "@/app/actions";

const initialState: CreateOperatorUserState = {
  ok: false,
  message: "",
};

export function UserCreateForm() {
  const [state, action, pending] = useActionState(createOperatorUserAction, initialState);

  return (
    <form action={action} className="grid gap-4 border border-zinc-800 bg-[#1d1e1c] p-5">
      <div className="flex items-center gap-2">
        <UserPlus className="h-5 w-5 text-sky-300" />
        <h2 className="text-lg font-semibold">Novo perfil</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Nome</span>
          <input
            name="fullName"
            required
            minLength={2}
            className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm outline-none focus:border-sky-500"
          />
          {state.errors?.fullName ? <span className="mt-1 block text-xs text-red-300">{state.errors.fullName[0]}</span> : null}
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">E-mail</span>
          <input
            name="email"
            type="email"
            required
            className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm outline-none focus:border-sky-500"
          />
          {state.errors?.email ? <span className="mt-1 block text-xs text-red-300">{state.errors.email[0]}</span> : null}
        </label>
      </div>
      <label>
        <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Perfil</span>
        <select
          name="role"
          defaultValue="operador"
          className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm outline-none [color-scheme:dark] focus:border-sky-500"
        >
          <option value="operador">Operador</option>
          <option value="analista">Analista</option>
        </select>
        {state.errors?.role ? <span className="mt-1 block text-xs text-red-300">{state.errors.role[0]}</span> : null}
      </label>
      <label>
        <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Senha temporária</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm outline-none focus:border-sky-500"
        />
        {state.errors?.password ? <span className="mt-1 block text-xs text-red-300">{state.errors.password[0]}</span> : null}
      </label>
      {state.message ? (
        <div className={`border px-3 py-2 text-sm ${state.ok ? "border-emerald-700 bg-emerald-950/40 text-emerald-200" : "border-red-800 bg-red-950/40 text-red-200"}`}>
          {state.message}
        </div>
      ) : null}
      <button
        disabled={pending}
        className="inline-flex h-10 w-fit items-center gap-2 rounded-md bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
        Criar perfil
      </button>
    </form>
  );
}
