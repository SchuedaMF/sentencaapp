import { Suspense } from "react";
import { AccountMenu, AccountMenuSkeleton } from "@/components/account-menu";
import { AppShell } from "@/components/app-shell";
import { getCurrentProfile } from "@/lib/data";

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      account={(
        <Suspense fallback={<AccountMenuSkeleton />}>
          <AccountMenu />
        </Suspense>
      )}
    >
      <Suspense fallback={<AuthenticatedContentSkeleton />}>
        <AuthenticatedContent>{children}</AuthenticatedContent>
      </Suspense>
    </AppShell>
  );
}

async function AuthenticatedContent({ children }: { children: React.ReactNode }) {
  await getCurrentProfile();
  return <>{children}</>;
}

function AuthenticatedContentSkeleton() {
  return (
    <>
      <div className="border-b border-zinc-800 px-5 py-4">
        <div className="h-7 w-36 animate-pulse rounded bg-zinc-800" />
      </div>
      <div className="space-y-4 p-5">
        <div className="h-12 animate-pulse rounded-md bg-zinc-900" />
        <div className="h-72 animate-pulse rounded-md border border-zinc-800 bg-[#1d1e1c]" />
      </div>
    </>
  );
}
