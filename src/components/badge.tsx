import { statusTone } from "@/lib/normalization";
import type { SentenceStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: SentenceStatus | null | undefined }) {
  return (
    <span className={`inline-flex h-7 items-center rounded-md border px-2 text-xs font-semibold ${statusTone(status)}`}>
      {status ?? "SEM STATUS"}
    </span>
  );
}

export function CountBadge({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-xs font-semibold text-zinc-100">{children}</span>;
}
