import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { LinkPendingIndicator } from "@/components/link-pending-indicator";
import type { QueueSortDirection } from "@/lib/queue";

type SortableQueueHeaderProps = {
  active: boolean;
  direction: QueueSortDirection;
  href: string;
  label: string;
};

export function SortableQueueHeader({ active, direction, href, label }: SortableQueueHeaderProps) {
  const Icon = direction === "desc" ? ArrowDown : ArrowUp;

  return (
    <Link
      className="relative inline-flex items-center gap-1.5 text-zinc-300 transition-colors hover:text-sky-100"
      href={href}
      prefetch={false}
    >
      <span>{label}</span>
      {active ? <Icon aria-hidden="true" className="h-3.5 w-3.5 text-sky-300" /> : null}
      <LinkPendingIndicator />
    </Link>
  );
}
