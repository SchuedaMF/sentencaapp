import { UserCreateForm } from "@/components/user-create-form";
import { canManageUsers, getCurrentProfile, getManagedUsers } from "@/lib/data";
import type { ManagedUser } from "@/lib/types";

export default async function ConfiguracoesPage() {
  const profile = await getCurrentProfile();
  const canCreateOperators = canManageUsers(profile);
  const users = canCreateOperators ? await getManagedUsers() : [];

  return (
    <>
      <div className="border-b border-zinc-800 px-5 py-4">
        <h1 className="text-xl font-semibold">Configuracoes</h1>
      </div>
      <div className="grid gap-5 p-5">
        <section className="max-w-3xl border border-zinc-800 bg-[#1d1e1c] p-5">
          <h2 className="mb-3 text-lg font-semibold">Perfis e permissoes</h2>
          <div className="grid gap-3 text-sm text-zinc-300 md:grid-cols-3">
            <div className="border border-zinc-800 p-3">
              <strong className="text-zinc-100">Admin</strong>
              <br />
              Configura usuarios, importacoes e listas.
            </div>
            <div className="border border-zinc-800 p-3">
              <strong className="text-zinc-100">Gestor</strong>
              <br />
              Ve e edita toda a operacao.
            </div>
            <div className="border border-zinc-800 p-3">
              <strong className="text-zinc-100">Operador</strong>
              <br />
              Ve casos atribuidos a seu nome.
            </div>
          </div>
        </section>
        {canCreateOperators ? (
          <section className="grid gap-5 xl:grid-cols-[minmax(360px,520px)_1fr]">
            <UserCreateForm />
            <UserList users={users} />
          </section>
        ) : (
          <section className="max-w-3xl border border-zinc-800 bg-[#1d1e1c] p-5 text-sm text-zinc-300">
            Seu perfil atual nao tem permissao para criar operadores.
          </section>
        )}
      </div>
    </>
  );
}

function UserList({ users }: { users: ManagedUser[] }) {
  return (
    <div className="overflow-hidden border border-zinc-800 bg-[#1d1e1c]">
      <div className="border-b border-zinc-800 px-5 py-4">
        <h2 className="text-lg font-semibold">Usuarios cadastrados</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[720px] w-full table-fixed text-left text-sm">
          <thead className="bg-[#222321] text-xs uppercase text-zinc-300">
            <tr className="[&>th]:border-b [&>th]:border-r [&>th]:border-zinc-800 [&>th]:px-4 [&>th]:py-3">
              <th className="w-[220px]">Nome</th>
              <th>E-mail</th>
              <th className="w-[120px]">Perfil</th>
              <th className="w-[110px]">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-4 py-3 font-semibold text-zinc-100">{user.full_name ?? "-"}</td>
                <td className="px-4 py-3 font-mono text-zinc-300">{user.email}</td>
                <td className="px-4 py-3 text-zinc-200">{user.role}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded px-2 py-1 text-xs font-semibold ${user.active ? "bg-emerald-950 text-emerald-200" : "bg-zinc-800 text-zinc-400"}`}>
                    {user.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {users.length === 0 ? <div className="p-8 text-center text-sm text-zinc-400">Nenhum usuario encontrado.</div> : null}
    </div>
  );
}
