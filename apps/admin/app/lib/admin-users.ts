import type { AdminUserListItem } from "@nexus/contracts";

export const ADMIN_USER_PAGE_SIZE = 20;

/** The API wraps the list as { status, count, users }. */
export function parseAdminUsers(data: unknown): AdminUserListItem[] {
  if (!data || typeof data !== "object") throw new Error("Invalid user response");
  const value = data as { users?: unknown };
  if (!Array.isArray(value.users)) throw new Error("Invalid user list response");
  for (const user of value.users) {
    if (!user || typeof user !== "object" || typeof (user as AdminUserListItem).id !== "string") {
      throw new Error("Invalid user item");
    }
  }
  return value.users as AdminUserListItem[];
}

export function adminUserDisplayName(user: AdminUserListItem): string {
  const profile = user.profile;
  const full = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim();
  return profile?.displayName || full || user.email || "Người dùng " + user.id.slice(0, 8);
}

export function adminUserInitials(user: AdminUserListItem): string {
  const parts = adminUserDisplayName(user).trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || "?").slice(0, 2);
  return letters.toUpperCase();
}

export function allAdminRoles(users: AdminUserListItem[]): string[] {
  return Array.from(new Set(users.flatMap(user => user.roles))).sort();
}

export interface UserView {
  items: AdminUserListItem[];
  total: number;
  totalPages: number;
  page: number;
}

export function viewAdminUsers(users: AdminUserListItem[], role: string, search: string, page: number): UserView {
  const needle = search.trim().toLowerCase();
  const filtered = users.filter(user => {
    if (role && !user.roles.includes(role)) return false;
    if (!needle) return true;
    return [adminUserDisplayName(user), user.email ?? ""].some(v => v.toLowerCase().includes(needle));
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / ADMIN_USER_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, Number.isSafeInteger(page) ? page : 1), totalPages);
  const start = (safePage - 1) * ADMIN_USER_PAGE_SIZE;
  return { items: filtered.slice(start, start + ADMIN_USER_PAGE_SIZE), total: filtered.length, totalPages, page: safePage };
}
