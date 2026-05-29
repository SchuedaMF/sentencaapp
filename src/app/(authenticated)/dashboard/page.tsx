import { Suspense } from "react";
import { connection } from "next/server";
import { DashboardChartIsland } from "@/components/dashboard-chart-island";
import { ProductionRanking } from "@/components/operator-production-ranking";
import { canViewAllOperationalData } from "@/lib/permissions";
import { getDashboardMetrics } from "@/lib/data";
import type { DashboardMetrics } from "@/lib/types";

export const unstable_instant = {
  prefetch: "runtime",
  unstable_disableValidation: true,
  samples: [
    { searchParams: { from: null, to: null } },
  ],
};

export default function DashboardPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  return (
    <>
      <div className="border-b border-zinc-800 px-5 py-4">
        <h1 className="text-xl font-semibold">DASHBOARD</h1>
      </div>
      <Suspense fallback={<DashboardMetricsSkeleton />}>
        <DashboardMetricsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function DashboardMetricsContent({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await connection();
  const params = await searchParams;
  const metrics = await getDashboardMetrics(params.from, params.to);

  return (
    <>
      <ProductionOverview metrics={metrics} />
      <div className="grid min-w-0 gap-4 px-5 pb-5 pt-4 xl:grid-cols-4">
        <DashboardChartIsland metrics={metrics} />
      </div>
    </>
  );
}

function ProductionOverview({ metrics }: { metrics: DashboardMetrics }) {
  const { production } = metrics;
  const showFullOperation = canViewAllOperationalData({ active: true, role: metrics.currentUser.role });

  return (
    <>
      <div className="grid gap-4 px-5 pt-5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Cumprimento hoje" value={production.today.cumprimento} accent="green" />
        <MetricCard label="Qualidade hoje" value={production.today.qualidade} accent="amber" />
        <MetricCard
          label="Cumprimento no mês"
          value={production.month.cumprimento}
          detail={`${formatAveragePerDay(production.month.cumprimento, production.occurrenceDays.cumprimento)} média/dia`}
          accent="green"
        />
        <MetricCard
          label="Qualidade no mês"
          value={production.month.qualidade}
          detail={`${formatAveragePerDay(production.month.qualidade, production.occurrenceDays.qualidade)} média/dia`}
          accent="amber"
        />
      </div>
      <div className="grid min-w-0 gap-4 px-5 pt-4 xl:grid-cols-4">
        <ProductionRanking production={production} showFullNames={showFullOperation} />
      </div>
    </>
  );
}

const metricAccentClasses = {
  default: "bg-zinc-700",
  sky: "bg-sky-400",
  green: "bg-emerald-400",
  amber: "bg-amber-400",
};

type MetricAccent = keyof typeof metricAccentClasses;

function MetricCard({
  label,
  value,
  detail,
  accent = "default",
}: {
  label: string;
  value: number;
  detail?: string;
  accent?: MetricAccent;
}) {
  return (
    <section className="relative overflow-hidden border border-zinc-800 bg-[#1d1e1c] p-4">
      <div className={`absolute inset-x-0 top-0 h-1 ${metricAccentClasses[accent]}`} />
      <div className="text-xs font-semibold uppercase text-zinc-500">{label}</div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-mono text-3xl font-semibold text-zinc-100">{value.toLocaleString("pt-BR")}</span>
        {detail ? <span className="text-sm font-medium text-zinc-400">({detail})</span> : null}
      </div>
    </section>
  );
}

function formatAveragePerDay(value: number, occurrenceDays: number) {
  if (value <= 0 || occurrenceDays <= 0) return "0";
  return (value / occurrenceDays).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

function DashboardMetricsSkeleton() {
  return (
    <>
      <div className="grid gap-4 px-5 pt-5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="h-[94px] animate-pulse border border-zinc-800 bg-[#1d1e1c]" key={index} />
        ))}
      </div>
      <div className="px-5 pt-4">
        <div className="h-80 animate-pulse border border-zinc-800 bg-[#1d1e1c]" />
      </div>
      <div className="grid min-w-0 gap-4 px-5 pb-5 pt-4 xl:grid-cols-4">
        <ChartCardSkeleton />
        <ChartCardSkeleton />
        <ChartCardSkeleton wide />
      </div>
    </>
  );
}

function ChartCardSkeleton({ wide }: { wide?: boolean }) {
  return (
    <section className={`min-w-0 border border-zinc-800 bg-[#1d1e1c] p-4 ${wide ? "xl:col-span-2" : ""}`}>
      <div className="mb-3 h-7 w-44 animate-pulse rounded bg-zinc-800" />
      <div className="h-72 min-w-0 animate-pulse rounded bg-zinc-900" />
    </section>
  );
}
