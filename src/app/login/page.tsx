import { Suspense } from "react";
import { Gavel } from "lucide-react";
import { signInAction } from "@/app/actions";

export default function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#171817] p-6 text-zinc-100">
      <form action={signInAction} className="w-full max-w-sm border border-zinc-800 bg-[#1d1e1c] p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-md bg-sky-600">
            <Gavel className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Cumprimento RJ</h1>
            <p className="text-sm text-zinc-400">Acesso da equipe</p>
          </div>
        </div>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">E-mail</span>
          <input name="email" type="email" required className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm" />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Senha</span>
          <input name="password" type="password" required className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm" />
        </label>
        <Suspense fallback={null}>
          <LoginError searchParams={searchParams} />
        </Suspense>
        <button className="h-10 w-full rounded-md bg-sky-600 text-sm font-semibold text-white hover:bg-sky-500">Entrar</button>
      </form>
    </main>
  );
}

async function LoginError({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  return params.error ? <p className="mb-4 text-sm text-red-300">{params.error}</p> : null;
}
