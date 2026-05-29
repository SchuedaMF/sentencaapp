"use client";

import { useMemo, useState } from "react";
import type { DashboardProduction, ProductionKind, ProductionPeriod } from "@/lib/types";

const modeLabels: Record<ProductionKind, string> = {
  cumprimento: "Cumprimento",
  qualidade: "Qualidade",
};

const periodLabels: Record<ProductionPeriod, string> = {
  month: "Mês",
  day: "Dia",
};

const periodTitleLabels: Record<ProductionPeriod, string> = {
  month: "mensal",
  day: "diário",
};

export function ProductionRanking({
  production,
  showFullNames,
}: {
  production: DashboardProduction;
  showFullNames: boolean;
}) {
  const [mode, setMode] = useState<ProductionKind>("cumprimento");
  const [period, setPeriod] = useState<ProductionPeriod>("month");
  const rows = production.ranking[mode][period];
  const maxValue = useMemo(() => Math.max(0, ...rows.map((row) => row.value)), [rows]);
  const subtitle = showFullNames
    ? `Produção da operação em ${modeLabels[mode].toLowerCase()} no ${period === "month" ? "mês" : "dia"}`
    : `Sua posição em ${modeLabels[mode].toLowerCase()} no ${period === "month" ? "mês" : "dia"}`;

  return (
    <section className="border border-zinc-800 bg-[#1d1e1c] p-4 xl:col-span-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Ranking {periodTitleLabels[period]}</h2>
          <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SegmentedControl
            ariaLabel="Alternar tipo de produção"
            labels={modeLabels}
            onChange={setMode}
            value={mode}
            values={["cumprimento", "qualidade"]}
          />
          <SegmentedControl
            ariaLabel="Alternar período do ranking"
            labels={periodLabels}
            onChange={setPeriod}
            value={period}
            values={["month", "day"]}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        {rows.length === 0 ? (
          <div className="border border-dashed border-zinc-800 bg-zinc-950/30 px-3 py-8 text-center text-sm text-zinc-500">
            Sem produção para este filtro.
          </div>
        ) : rows.map((row) => {
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
              key={`${mode}-${period}-${row.position}-${row.name}`}
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
                <div className="mt-1 truncate text-xs text-zinc-500">
                  Total: {row.total.toLocaleString("pt-BR")} · Entregue: {row.delivered.toLocaleString("pt-BR")} · Pendente: {row.pending.toLocaleString("pt-BR")}
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

function SegmentedControl<T extends string>({
  ariaLabel,
  labels,
  onChange,
  value,
  values,
}: {
  ariaLabel: string;
  labels: Record<T, string>;
  onChange: (value: T) => void;
  value: T;
  values: T[];
}) {
  return (
    <div
      aria-label={ariaLabel}
      className="inline-flex w-fit rounded-full border border-zinc-700 bg-zinc-950/60 p-1"
      role="group"
    >
      {values.map((item) => (
        <button
          aria-pressed={value === item}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
            value === item
              ? "bg-sky-500 text-white"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          }`}
          key={item}
          onClick={() => onChange(item)}
          type="button"
        >
          {labels[item]}
        </button>
      ))}
    </div>
  );
}
