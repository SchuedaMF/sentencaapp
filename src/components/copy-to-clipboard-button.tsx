"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

type CopyStatus = "idle" | "copied" | "error";

type CopyToClipboardButtonProps = {
  text: string;
  title: string;
  ariaLabel: string;
  copiedLabel?: string;
  errorLabel?: string;
  disabled?: boolean;
};

export function CopyToClipboardButton({
  text,
  title,
  ariaLabel,
  copiedLabel = "Copiado",
  errorLabel = "Nao foi possivel copiar",
  disabled = false,
}: CopyToClipboardButtonProps) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const resetCopyStatusTimeoutRef = useRef<number | null>(null);
  const copyFeedbackText = copyStatus === "copied" ? copiedLabel : copyStatus === "error" ? errorLabel : "";
  const isDisabled = disabled || text.trim().length === 0;

  useEffect(() => {
    return () => {
      if (resetCopyStatusTimeoutRef.current) window.clearTimeout(resetCopyStatusTimeoutRef.current);
    };
  }, []);

  async function handleCopy() {
    if (isDisabled) return;

    if (!navigator.clipboard) {
      showCopyStatus("error");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      showCopyStatus("copied");
    } catch {
      showCopyStatus("error");
    }
  }

  function showCopyStatus(status: Exclude<CopyStatus, "idle">) {
    if (resetCopyStatusTimeoutRef.current) window.clearTimeout(resetCopyStatusTimeoutRef.current);

    setCopyStatus(status);
    resetCopyStatusTimeoutRef.current = window.setTimeout(() => {
      setCopyStatus("idle");
      resetCopyStatusTimeoutRef.current = null;
    }, 1800);
  }

  return (
    <div className="inline-flex shrink-0 items-center gap-2">
      <span
        aria-live="polite"
        className={`shrink-0 text-xs font-semibold ${
          copyStatus === "copied" ? "text-emerald-300" : copyStatus === "error" ? "text-red-300" : "sr-only"
        }`}
      >
        {copyFeedbackText}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        disabled={isDisabled}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-700 bg-zinc-950/80 text-zinc-300 transition-colors hover:border-sky-500/50 hover:text-sky-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-zinc-700 disabled:hover:text-zinc-300"
        title={title}
        aria-label={ariaLabel}
      >
        {copyStatus === "copied" ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}
