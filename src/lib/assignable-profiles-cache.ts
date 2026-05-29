import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { canBeAssignedOperationalWork } from "@/lib/permissions";
import type { AssignableProfile, Profile } from "@/lib/types";

export const assignableProfilesCacheTag = "assignable-profiles";

export async function getCachedAssignableProfiles(): Promise<AssignableProfile[] | null> {
  "use cache";

  cacheLife({ stale: 60, revalidate: 60, expire: 300 });
  cacheTag(assignableProfilesCacheTag);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const admin = createClient(url, key, {
    auth: { persistSession: false },
  });

  const { data, error } = await admin
    .from("profiles")
    .select("id,email,full_name,role,active")
    .eq("active", true)
    .order("full_name", { ascending: true, nullsFirst: false })
    .order("email", { ascending: true });

  if (error) throw new Error(`getCachedAssignableProfiles failed: ${error.message}`);

  return ((data ?? []) as Profile[])
    .filter(canBeAssignedOperationalWork)
    .map((profile) => ({
      id: profile.id,
      displayName: profile.full_name?.trim() || profile.email,
      email: profile.email,
      role: profile.role,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.email.localeCompare(b.email));
}
