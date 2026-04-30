import { Database, FileWarning, ShieldCheck } from "lucide-react";

export default function ImportacaoPage() {
  return (
    <>
      <div className="border-b border-zinc-800 px-5 py-4">
        <h1 className="text-xl font-semibold">Importacao</h1>
      </div>
      <div className="grid gap-5 p-5 lg:grid-cols-3">
        <Info title="Campos canonicos" icon={<ShieldCheck className="h-5 w-5 text-emerald-300" />}>
          STATUS_CUMPRIMENTO, STATUS_QUALIDADE, DATA_CUMPRIMENTO, DATA_QUALIDADE e DATA_ULTIMO_EVENTO sao a verdade operacional.
        </Info>
        <Info title="Campos preservados so no bruto" icon={<FileWarning className="h-5 w-5 text-amber-300" />}>
          STATUS CUMPRIMENTO, STATUS QUALIDADE, DATA DO INGRESSO CUMPRIMENTO, DATA QUALIDADE e DATA_PENDENTE nao entram no app.
        </Info>
        <Info title="Comando" icon={<Database className="h-5 w-5 text-sky-300" />}>
          Rode npm run import:sentencas -- &quot;C:/Users/jur.david/Documents/Base RJ - Sentenca.xlsx&quot;. Sem env do Supabase, o comando gera outputs/import-preview.json.
        </Info>
      </div>
    </>
  );
}

function Info({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border border-zinc-800 bg-[#1d1e1c] p-5">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="font-semibold">{title}</h2>
      </div>
      <p className="text-sm leading-6 text-zinc-300">{children}</p>
    </section>
  );
}
