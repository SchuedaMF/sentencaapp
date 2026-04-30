"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

type ClickableTableRowProps = {
  href: string;
  label: string;
  children: ReactNode;
  className?: string;
};

const interactiveSelector = 'a, button, input, select, textarea, [role="button"], [role="link"], [data-row-interactive="true"]';

export function ClickableTableRow({ href, label, children, className }: ClickableTableRowProps) {
  const router = useRouter();
  const prefetchedRef = useRef(false);

  function prefetchCase() {
    if (prefetchedRef.current) return;
    prefetchedRef.current = true;
    router.prefetch(href);
  }

  function openCase(event?: MouseEvent<HTMLTableRowElement>) {
    if (event?.metaKey || event?.ctrlKey) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }

    router.push(href);
  }

  function handleClick(event: MouseEvent<HTMLTableRowElement>) {
    if (event.defaultPrevented || event.button !== 0 || shouldIgnorePointerEvent(event)) return;
    event.preventDefault();
    openCase(event);
  }

  function handleAuxClick(event: MouseEvent<HTMLTableRowElement>) {
    if (event.button !== 1 || shouldIgnorePointerEvent(event)) return;
    event.preventDefault();
    window.open(href, "_blank", "noopener,noreferrer");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;

    event.preventDefault();
    prefetchCase();
    router.push(href);
  }

  return (
    <tr
      aria-label={label}
      className={className}
      onAuxClick={handleAuxClick}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onFocus={prefetchCase}
      onPointerEnter={prefetchCase}
      onTouchStart={prefetchCase}
      role="link"
      tabIndex={0}
      title={label}
    >
      {children}
    </tr>
  );
}

function shouldIgnorePointerEvent(event: MouseEvent<HTMLTableRowElement>) {
  const target = event.target;
  if (target instanceof HTMLElement) {
    const interactiveTarget = target.closest(interactiveSelector);
    if (interactiveTarget && interactiveTarget !== event.currentTarget) return true;
  }

  const selection = window.getSelection();
  if (!selection?.toString().trim()) return false;

  return Boolean(
    (selection.anchorNode && event.currentTarget.contains(selection.anchorNode)) ||
      (selection.focusNode && event.currentTarget.contains(selection.focusNode)),
  );
}
