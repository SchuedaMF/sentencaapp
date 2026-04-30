import Link from "next/link";
import { Suspense } from "react";
import { Gavel } from "lucide-react";
import { GlobalQueueSearch } from "@/components/queue-search-form";
import {
  DesktopShellNavigation,
  DesktopShellNavigationFallback,
  MobileShellNavigation,
  MobileShellNavigationFallback,
} from "@/components/shell-navigation";

export function AppShell({ account, children }: { account: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#171817] text-zinc-100">
      <header className="sticky top-0 z-30 flex h-16 items-center border-b border-zinc-800 bg-[#20211f] px-4">
        <Link href="/dashboard" className="mr-4 flex min-w-0 items-center gap-3 text-lg font-semibold">
          <Gavel className="h-6 w-6 shrink-0 text-sky-300" />
          <span className="hidden truncate sm:inline">Cumprimento RJ - Sentença</span>
          <span className="sm:hidden">Sentença</span>
        </Link>
        <Suspense fallback={<QueueSearchFallback className="mx-auto hidden w-full max-w-xl md:block" />}>
          <GlobalQueueSearch className="mx-auto hidden w-full max-w-xl md:block" />
        </Suspense>
        <div className="ml-auto flex items-center gap-3">{account}</div>
      </header>
      <div className="sticky top-16 z-20 border-b border-zinc-800 bg-[#20211f] p-3 md:hidden">
        <Suspense fallback={<QueueSearchFallback />}>
          <GlobalQueueSearch />
        </Suspense>
      </div>
      <div className="flex">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-[70px] border-r border-zinc-800 bg-[#242523] md:block">
          <Suspense fallback={<DesktopShellNavigationFallback />}>
            <DesktopShellNavigation />
          </Suspense>
        </aside>
        <main className="min-w-0 flex-1 pb-20 md:pb-0">{children}</main>
      </div>
      <Suspense fallback={<MobileShellNavigationFallback />}>
        <MobileShellNavigation />
      </Suspense>
    </div>
  );
}

function QueueSearchFallback({ className = "" }: { className?: string }) {
  return (
    <div className={`w-full ${className}`}>
      <div className="h-10 rounded-md border border-zinc-700 bg-zinc-950" />
    </div>
  );
}
