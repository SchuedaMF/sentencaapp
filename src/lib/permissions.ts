import type { Profile } from "@/lib/types";

type RoleProfile = Pick<Profile, "active" | "role">;

export function canManageOperationalData(profile: RoleProfile) {
  return profile.active && (profile.role === "admin" || profile.role === "gestor");
}

export function canViewAllOperationalData(profile: RoleProfile) {
  return canManageOperationalData(profile) || (profile.active && profile.role === "analista");
}

export function canCreateOwnEvents(profile: RoleProfile) {
  return profile.active && profile.role !== "analista";
}

export function canExportSentences(profile: RoleProfile) {
  return canViewAllOperationalData(profile);
}

export function canBeAssignedOperationalWork(profile: RoleProfile) {
  return profile.active && profile.role !== "analista";
}
