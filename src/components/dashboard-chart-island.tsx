"use client";

import dynamic from "next/dynamic";
import type { DashboardMetrics } from "@/lib/types";

const DashboardCharts = dynamic(
  () => import("@/components/dashboard-charts").then((mod) => mod.DashboardCharts),
  {
    ssr: false,
    loading: () => <DashboardChartsSkeleton />,
  },
);

export function DashboardChartIsland({ metrics }: { metrics: DashboardMetrics }) {
  return <DashboardCharts metrics={metrics} />;
}

function DashboardChartsSkeleton() {
  return (
    <>
      <ChartCardSkeleton title="Cumprimento - Status" />
      <ChartCardSkeleton title="Qualidade - Status" />
      <ChartCardSkeleton title="Dados gerais" wide />
    </>
  );
}

function ChartCardSkeleton({ title, wide }: { title: string; wide?: boolean }) {
  return (
    <section className={`min-w-0 border border-zinc-800 bg-[#1d1e1c] p-4 ${wide ? "xl:col-span-2" : ""}`}>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div className="h-72 min-w-0 animate-pulse rounded bg-zinc-900" />
      {!wide ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-8 animate-pulse border border-zinc-800 bg-zinc-900" />
          ))}
        </div>
      ) : null}
    </section>
  );
}
