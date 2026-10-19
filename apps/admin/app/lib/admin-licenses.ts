import type { AdminLicenseDto, AdminLicenseRevokeReason, LicenseStatus } from "@nexus/contracts";

export const ADMIN_LICENSE_PAGE_SIZE = 20;

export const ADMIN_LICENSE_STATUSES: ReadonlyArray<{ value: LicenseStatus | ""; label: string }> = [
  { value: "", label: "Tất cả trạng thái" },
  { value: "ACTIVE", label: "Hoạt động" },
  { value: "REVOKED", label: "Đã thu hồi" },
];

export const ADMIN_LICENSE_REVOKE_REASONS: ReadonlyArray<{ value: AdminLicenseRevokeReason; label: string }> = [
  { value: "ADMINISTRATIVE", label: "Quản trị" },
  { value: "REFUND", label: "Hoàn tiền" },
  { value: "FRAUD", label: "Gian lận" },
  { value: "SUPPORT", label: "Hỗ trợ khách" },
  { value: "SECURITY", label: "Bảo mật" },
  { value: "OTHER", label: "Khác" },
];

/** The API returns the whole list (no server paging); validate the array shape. */
export function parseAdminLicenseList(data: unknown): AdminLicenseDto[] {
  if (!Array.isArray(data)) throw new Error("Invalid license list response");
  for (const item of data) {
    if (!item || typeof item !== "object" || typeof (item as AdminLicenseDto).id !== "string") {
      throw new Error("Invalid license item");
    }
  }
  return data as AdminLicenseDto[];
}

export interface LicenseView {
  items: AdminLicenseDto[];
  total: number;
  totalPages: number;
  page: number;
}

/** Client-side filter + paging; keeps the key masked and never fabricates counts. */
export function viewAdminLicenses(
  all: AdminLicenseDto[],
  status: LicenseStatus | "",
  search: string,
  page: number,
): LicenseView {
  const needle = search.trim().toLowerCase();
  const filtered = all.filter(item => {
    if (status && item.status !== status) return false;
    if (!needle) return true;
    return [item.keyLast4, item.userId, item.entitlementId, item.productId].some(v => String(v).toLowerCase().includes(needle));
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / ADMIN_LICENSE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, Number.isSafeInteger(page) ? page : 1), totalPages);
  const start = (safePage - 1) * ADMIN_LICENSE_PAGE_SIZE;
  return { items: filtered.slice(start, start + ADMIN_LICENSE_PAGE_SIZE), total: filtered.length, totalPages, page: safePage };
}

export function maskedLicenseKey(keyLast4: string): string {
  return "NXS-****-****-" + (keyLast4 || "????");
}

export function adminLicenseStatusLabel(status: LicenseStatus): string {
  return ADMIN_LICENSE_STATUSES.find(item => item.value === status)?.label || status;
}

export function isRevokeReason(value: string): value is AdminLicenseRevokeReason {
  return ADMIN_LICENSE_REVOKE_REASONS.some(item => item.value === value);
}
