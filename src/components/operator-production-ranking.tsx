"use client";

import { useMemo, useState } from "react";
import type { DashboardProduction, ProductionKind } from "@/lib/types";

const modeLabels: Record<ProductionKind, string> = {
  cumprimento: "Cumprimento",
  qualidade: "Qualidade",
};

export function ProductionRanking({
  production,
  showFullNames,
}: {
  production: DashboardProduction;
  showFullNames: boolean;
}) {
  const [mode, setMode] = useState<ProductionKind>("cumprimento");
  const rows = production.ranking[mode];
  const maxValue = useMemo(() => Math.max(0, ...rows.map((row) => row.value)), [rows]);
  const subtitle = showFullNames
    ? `Produção da operação em ${modeLabels[mode].toLowerCase()} no mês`
    : `Sua posição em ${modeLabels[mode].toLowerCase()} no mês`;

  return (
    <section className="border border-zinc-800 bg-[#1d1e1c] p-4 xl:col-span-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Ranking mensal</h2>
          <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
        </div>
        <div
          aria-label="Alternar tipo de produção"
          className="inline-flex w-fit rounded-full border border-zinc-700 bg-zinc-950/60 p-1"
          role="group"
        >
          {(Object.keys(modeLabels) as ProductionKind[]).map((item) => (
            <button
              aria-pressed={mode === item}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === item
                  ? "bg-sky-500 text-white"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              }`}
              key={item}
              onClick={() => setMode(item)}
              type="button"
            >
              {modeLabels[item]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        {rows.map((row) => {
          const width = maxValue > 0 ? Math.max(4, (row.value / maxValue) * 100) : 0;
          const maskName = !showFullNames && !row.isCurrentUser;

          return (
            <div
              aria-label={maskName ? `Usuário na posição ${row.position}` : `${row.name} na posição ${row.position}`}
              className={`grid grid-cols-[3.5rem_minmax(0,1fr)_5rem] items-center gap-3 border px-3 py-2 ${
                row.isCurrentUser
                  ? "border-sky-500/50 bg-sky-500/10"
                  : "border-zinc-800 bg-zinc-950/30"
              }`}
              key={`${mode}-${row.position}-${row.name}`}
            >
              <span className="font-mono text-sm font-semibold text-zinc-400">#{row.position}</span>
              <div className="min-w-0">
                <div
                  className={`truncate text-sm font-semibold ${
                    maskName
                      ? "select-none blur-[3px] text-zinc-500"
                      : "text-zinc-50"
                  }`}
                >
                  {row.name}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-900">
                  <div className="h-full rounded-full bg-sky-400" style={{ width: `${width}%` }} />
                </div>
              </div>
              <strong className="text-right font-mono text-lg font-semibold text-zinc-100">
                {row.value.toLocaleString("pt-BR")}
              </strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}
