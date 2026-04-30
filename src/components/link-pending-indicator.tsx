"use client";

import { useLinkStatus } from "next/link";

export function LinkPendingIndicator({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus();

  return (
    <span
      aria-hidden="true"
      className={`link-pending-indicator ${pending ? "is-pending" : ""} ${className}`}
    />
  );
}
