import { AlertTriangle, CheckCircle2, ClipboardList } from "lucide-react";
import type { SalesforceOrderQueueSummary } from "@/lib/types";

export function OrderSummaryCell({ summary }: { summary?: SalesforceOrderQueueSummary }) {
  if (!summary || summary.totalOrders === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-zinc-500">
        <ClipboardList className="h-4 w-4" />
        Sem ordens
      </span>
    );
  }

  if (summary.openOrders === 0 && summary.unknownOrders === 0) {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-emerald-200">
        <CheckCircle2 className="h-4 w-4" />
        Todas fechadas ({summary.totalOrders})
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex items-center gap-1 font-semibold text-amber-200">
        <AlertTriangle className="h-4 w-4" />
        {summary.openOrders} abertas de {summary.totalOrders}
      </span>
      {summary.unknownOrders > 0 ? (
        <span className="text-xs font-semibold text-zinc-400">
          {summary.unknownOrders} sem status
        </span>
      ) : null}
    </span>
  );
}
