"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildQueueHref } from "@/lib/queue";
import type { DashboardMetrics, SentenceStatus } from "@/lib/types";

const colors: Record<SentenceStatus, string> = {
  ENTREGUE: "#10b981",
  PENDENTE: "#ef4444",
  "EM ANDAMENTO": "#f59e0b",
  ESTOQUE: "#38bdf8",
};

export function DashboardCharts({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <>
      <StatusPie title="Cumprimento - Status" data={metrics.cumprimentoStatus} stage="CUMPRIMENTO" />
      <StatusPie title="Qualidade - Status" data={metrics.qualidadeStatus} stage="QUALIDADE" />
      <TrendChart data={metrics.points} />
    </>
  );
}

export function StatusPie({
  title,
  data,
  stage,
}: {
  title: string;
  data: DashboardMetrics["cumprimentoStatus"];
  stage: "CUMPRIMENTO" | "QUALIDADE";
}) {
  const mounted = useMounted();
  const router = useRouter();
  const rows = Object.entries(data).map(([name, value]) => ({ name: name as SentenceStatus, value }));

  function hrefForStatus(status: SentenceStatus) {
    return buildQueueHref({ stage, status, view: "dashboard-status" });
  }

  function navigateToStatus(status: SentenceStatus, value: number) {
    if (value <= 0) return;
    router.push(hrefForStatus(status));
  }

  function handlePieClick(entry: unknown) {
    if (!entry || typeof entry !== "object" || !("name" in entry)) return;
    const status = (entry as { name?: unknown }).name;
    if (typeof status !== "string") return;
    const row = rows.find((item) => item.name === status);
    if (row) navigateToStatus(row.name, row.value);
  }

  return (
    <section className="min-w-0 border border-zinc-800 bg-[#1d1e1c] p-4">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div className="h-72 min-w-0">
        {mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", color: "#fff" }} />
              <Pie data={rows} dataKey="value" nameKey="name" innerRadius={45} outerRadius={105} onClick={handlePieClick} paddingAngle={2}>
                {rows.map((entry) => (
                  <Cell
                    className={entry.value > 0 ? "cursor-pointer outline-none" : ""}
                    fill={colors[entry.name]}
                    key={entry.name}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        ) : <ChartSkeleton />}
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-2 text-sm text-zinc-300">
        {rows.map((row) => {
          const content = (
            <>
              <span>{row.name}</span>
              <strong>{row.value}</strong>
            </>
          );

          if (row.value <= 0) {
            return (
              <div aria-disabled="true" key={row.name} className="flex items-center justify-between border border-zinc-800 px-2 py-1 text-zinc-500">
                {content}
              </div>
            );
          }

          return (
            <Link
              aria-label={`Abrir ${row.value} processo(s) em ${stage} com status ${row.name}`}
              className="flex items-center justify-between border border-zinc-800 px-2 py-1 transition-colors hover:border-sky-500/60 hover:bg-sky-500/15 hover:text-sky-100"
              href={hrefForStatus(row.name)}
              key={row.name}
            >
              {content}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function TrendChart({ data }: { data: DashboardMetrics["points"] }) {
  const mounted = useMounted();
  return (
    <section className="min-w-0 border border-zinc-800 bg-[#1d1e1c] p-4 xl:col-span-2">
      <h2 className="mb-3 text-lg font-semibold">Dados gerais</h2>
      <div className="h-72 min-w-0">
        {mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid stroke="#3f3f46" strokeDasharray="4 4" />
              <XAxis dataKey="date" stroke="#a1a1aa" fontSize={12} />
              <YAxis stroke="#a1a1aa" fontSize={12} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", color: "#fff" }} />
              <Line type="monotone" dataKey="recebido" stroke="#38bdf8" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="cumprimento" stroke="#10b981" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="qualidade" stroke="#f59e0b" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="pendente" stroke="#ef4444" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : <ChartSkeleton />}
      </div>
    </section>
  );
}

function useMounted() {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

function ChartSkeleton() {
  return <div className="h-full w-full animate-pulse rounded bg-zinc-900" />;
}
