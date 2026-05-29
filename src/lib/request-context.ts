import { cache } from "react";
import { redirect } from "next/navigation";
import { sampleProfile } from "@/lib/sample-data";
import { canManageOperationalData, canViewAllOperationalData } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export type SupabaseServerClient = NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;

export type AppRequestContext = {
  supabase: SupabaseServerClient | null;
  userId: string | null;
  profile: Profile;
  isManager: boolean;
  canViewAllData: boolean;
  responsibleName: string;
};

export const getAppRequestContext = cache(async (): Promise<AppRequestContext> => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      supabase: null,
      userId: null,
      profile: sampleProfile,
      isManager: true,
      canViewAllData: true,
      responsibleName: sampleProfile.full_name ?? sampleProfile.email,
    };
  }

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,role,active")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (error) throw new Error(`getAppRequestContext failed: ${error.message}`);
  if (data && !data.active) redirect("/login?error=Usuario%20inativo");

  const profile = data
    ? (data as Profile)
    : {
        id: auth.user.id,
        email: auth.user.email ?? "",
        full_name: auth.user.user_metadata?.full_name ?? null,
        role: "operador" as const,
        active: true,
      };

  return {
    supabase,
    userId: auth.user.id,
    profile,
    isManager: canManageOperationalData(profile),
    canViewAllData: canViewAllOperationalData(profile),
    responsibleName: profile.full_name?.trim() || profile.email,
  };
});
