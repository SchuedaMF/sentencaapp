import { Search } from "lucide-react";
import { CountBadge } from "@/components/badge";

export function Filters({
  action,
  lockedResponsible,
  status,
  statusValue,
  responsible,
  responsibleValue,
  query,
  showResponsibleFilter = true,
}: {
  action: string;
  lockedResponsible?: string | null;
  status: Array<[string, number]>;
  statusValue?: string;
  responsible: Array<[string, number]>;
  responsibleValue?: string;
  query?: string;
  showResponsibleFilter?: boolean;
}) {
  const total = status.reduce((sum, [, count]) => sum + count, 0) || responsible.reduce((sum, [, count]) => sum + count, 0);

  return (
    <form action={action} className="flex flex-wrap items-end gap-3 border-b border-zinc-800 bg-[#1d1e1c] p-4">
      <label className="min-w-[260px] flex-1">
        <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Busca</span>
        <div className="flex h-10 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-3">
          <Search className="h-4 w-4 text-zinc-500" />
          <input name="q" defaultValue={query} placeholder="Processo, autor, CPF/CNPJ ou UC" className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-600" />
        </div>
      </label>
      <label>
        <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Status</span>
        <select name="status" defaultValue={statusValue ?? "ALL"} className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm">
          <option value="ALL">Todos</option>
          {status.map(([value, count]) => (
            <option key={value} value={value}>{`${value} (${count})`}</option>
          ))}
        </select>
      </label>
      {showResponsibleFilter ? (
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Responsavel</span>
          <select name="responsible" defaultValue={responsibleValue ?? "ALL"} className="h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm">
            <option value="ALL">Todos</option>
            {responsible.map(([value, count]) => (
              <option key={value} value={value}>{`${value} (${count})`}</option>
            ))}
          </select>
        </label>
      ) : (
        <div>
          <span className="mb-1 block text-xs font-semibold uppercase text-zinc-400">Responsavel</span>
          <div className="flex h-10 items-center rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm font-semibold text-zinc-200">
            {lockedResponsible ?? "Minha fila"}
          </div>
        </div>
      )}
      <button className="h-10 rounded-md bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-500">Filtrar</button>
      <div className="ml-auto flex gap-2 text-sm text-zinc-300">
        <span>Total</span>
        <CountBadge>{total}</CountBadge>
      </div>
    </form>
  );
}
