"use client";

import { useCallback } from "react";
import { useAuth } from "../context/auth-context";

type PermissionHolder = { roles?: string[] | null; permissions?: string[] | null } | null | undefined;

/**
 * Mirrors the API PermissionsGuard: super_admin passes, otherwise every listed
 * permission is required. UI-only — the API still enforces each permission.
 */
export function hasPermissions(user: PermissionHolder, permissions: string[]): boolean {
  if (!user) return false;
  if (user.roles?.includes("super_admin")) return true;
  const granted = user.permissions || [];
  return permissions.every((p) => granted.includes(p));
}

/** Decides which admin controls are enabled for the signed-in user. */
export function useCan(): (...permissions: string[]) => boolean {
  const { user } = useAuth();
  return useCallback((...permissions: string[]) => hasPermissions(user, permissions), [user]);
}

/** Browser confirmation for irreversible or customer-visible actions. */
export function confirmAction(message: string): boolean {
  return typeof window === "undefined" ? false : window.confirm(message);
}
