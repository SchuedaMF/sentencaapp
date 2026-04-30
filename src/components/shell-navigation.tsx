"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ClipboardList, Database, Settings } from "lucide-react";
import { LinkPendingIndicator } from "@/components/link-pending-indicator";
import { buildQueueHref } from "@/lib/queue";

const navItems = [
  { href: "/dashboard", label: "Dashboard", section: "dashboard", icon: BarChart3 },
  { href: buildQueueHref({ stage: "CUMPRIMENTO", status: "EM ANDAMENTO" }), label: "Fila", section: "fila", icon: ClipboardList },
  { href: "/importacao", label: "Importação", section: "importacao", icon: Database },
  { href: "/configuracoes", label: "Configurações", section: "configuracoes", icon: Settings },
] as const;

export function DesktopShellNavigation() {
  const activeSection = useActiveSection();

  return <DesktopNav activeSection={activeSection} />;
}

export function DesktopShellNavigationFallback() {
  return <DesktopNav activeSection={null} />;
}

export function MobileShellNavigation() {
  const activeSection = useActiveSection();

  return <MobileNav activeSection={activeSection} />;
}

export function MobileShellNavigationFallback() {
  return <MobileNav activeSection={null} />;
}

function DesktopNav({ activeSection }: { activeSection: string | null }) {

  return (
    <nav aria-label="Principal" className="flex flex-col items-center gap-2 py-4">
      {navItems.map((item) => {
        const active = item.section === activeSection;

        return (
          <Link
            aria-current={active ? "page" : undefined}
            aria-label={item.label}
            className={`relative grid h-11 w-11 place-items-center rounded-md transition-colors ${
              active
                ? "bg-sky-600 text-white"
                : "text-zinc-300 hover:bg-sky-500/15 hover:text-sky-200"
            }`}
            href={item.href}
            key={item.href}
            title={item.label}
          >
            <item.icon className="h-5 w-5" />
            <LinkPendingIndicator className="absolute right-1.5 top-1.5" />
          </Link>
        );
      })}
    </nav>
  );
}

function MobileNav({ activeSection }: { activeSection: string | null }) {
  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-zinc-800 bg-[#20211f]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {navItems.map((item) => {
        const active = item.section === activeSection;

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`relative flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-center text-[10px] font-semibold leading-none transition-colors ${
              active
                ? "text-sky-200"
                : "text-zinc-400 hover:bg-sky-500/10 hover:text-sky-100"
            }`}
            href={item.href}
            key={item.href}
          >
            <item.icon className="h-5 w-5" />
            <span className="max-w-full truncate">{item.label}</span>
            <LinkPendingIndicator className="absolute right-2 top-2" />
          </Link>
        );
      })}
    </nav>
  );
}

function useActiveSection() {
  const pathname = usePathname();

  if (pathname === "/" || pathname.startsWith("/dashboard")) return "dashboard";
  if (
    pathname.startsWith("/fila") ||
    pathname.startsWith("/cumprimento") ||
    pathname.startsWith("/qualidade") ||
    pathname.startsWith("/sentencas")
  ) {
    return "fila";
  }
  if (pathname.startsWith("/importacao")) return "importacao";
  if (pathname.startsWith("/configuracoes")) return "configuracoes";
  return null;
}
