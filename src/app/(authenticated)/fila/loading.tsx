import { OperationalQueueSkeleton } from "@/components/operational-queue";

export default function Loading() {
  return (
    <>
      <div className="border-b border-zinc-800 px-5 py-4">
        <div className="h-7 w-24 animate-pulse rounded bg-zinc-800" />
      </div>
      <OperationalQueueSkeleton />
    </>
  );
}
