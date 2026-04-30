import { LogOut } from "lucide-react";
import { signOutAction } from "@/app/actions";
import { getCurrentProfile } from "@/lib/data";
import { initials } from "@/lib/normalization";

export async function AccountMenu() {
  const profile = await getCurrentProfile();

  return (
    <>
      <div className="hidden text-right text-xs text-zinc-400 sm:block">
        <div className="font-semibold text-zinc-100">{profile.full_name ?? profile.email}</div>
        <div>{profile.role}</div>
      </div>
      <div className="grid h-9 w-9 place-items-center rounded-full bg-sky-600 text-sm font-bold">{initials(profile.full_name ?? profile.email)}</div>
      <form action={signOutAction}>
        <button className="grid h-9 w-9 place-items-center rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800" title="Sair">
          <LogOut className="h-4 w-4" />
        </button>
      </form>
    </>
  );
}

export function AccountMenuSkeleton() {
  return (
    <>
      <div className="hidden w-28 space-y-1 sm:block">
        <div className="ml-auto h-3 w-24 animate-pulse rounded bg-zinc-800" />
        <div className="ml-auto h-3 w-14 animate-pulse rounded bg-zinc-800" />
      </div>
      <div className="h-9 w-9 animate-pulse rounded-full bg-zinc-800" />
      <div className="h-9 w-9 animate-pulse rounded-md border border-zinc-800 bg-zinc-900" />
    </>
  );
}
