import type { EntitlementDto, EntitlementStatus, PaginatedResponse } from "@nexus/contracts";

export const ADMIN_ENTITLEMENT_PAGE_SIZE = 20;

export const ADMIN_ENTITLEMENT_STATUSES: ReadonlyArray<{ value: EntitlementStatus | ""; label: string }> = [
  { value: "", label: "Tất cả trạng thái" },
  { value: "ACTIVE", label: "Hoạt động" },
  { value: "REVOKED", label: "Đã thu hồi" },
  { value: "EXPIRED", label: "Hết hạn" },
];

export const ADMIN_FULFILLMENT_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Tất cả loại cấp quyền" },
  { value: "DIGITAL_DOWNLOAD", label: "Tải file" },
  { value: "INTERNAL_LICENSE", label: "License nội bộ" },
  { value: "EXTERNAL_MANAGED", label: "Quản lý hộ" },
  { value: "MEMBERSHIP_ACCESS", label: "Thành viên" },
  { value: "MANUAL_SERVICE", label: "Dịch vụ thủ công" },
  { value: "HOSTING_PROVISIONING", label: "Hosting" },
];

export function adminEntitlementQuery(
  page: number,
  status: EntitlementStatus | "",
  fulfillmentType: string,
): string {
  const validPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const params = new URLSearchParams({ page: String(validPage), limit: String(ADMIN_ENTITLEMENT_PAGE_SIZE) });
  if (status && ADMIN_ENTITLEMENT_STATUSES.some(item => item.value === status)) params.set("status", status);
  if (fulfillmentType && ADMIN_FULFILLMENT_TYPES.some(item => item.value === fulfillmentType)) {
    params.set("fulfillmentType", fulfillmentType);
  }
  return params.toString();
}

export function parseAdminEntitlementPage(data: unknown): PaginatedResponse<EntitlementDto> {
  if (!data || typeof data !== "object") throw new Error("Invalid entitlement response");
  const value = data as Partial<PaginatedResponse<EntitlementDto>>;
  if (
    !Array.isArray(value.items) ||
    !Number.isSafeInteger(value.total) || (value.total ?? -1) < 0 ||
    !Number.isSafeInteger(value.page) || (value.page ?? 0) < 1 ||
    !Number.isSafeInteger(value.limit) || (value.limit ?? 0) < 1 ||
    !Number.isSafeInteger(value.totalPages) || (value.totalPages ?? 0) < 1
  ) {
    throw new Error("Invalid paginated entitlement response");
  }
  return value as PaginatedResponse<EntitlementDto>;
}

export function adminEntitlementStatusLabel(status: EntitlementStatus): string {
  return ADMIN_ENTITLEMENT_STATUSES.find(item => item.value === status)?.label || status;
}

export function adminFulfillmentLabel(type: string): string {
  return ADMIN_FULFILLMENT_TYPES.find(item => item.value === type)?.label || type;
}

/** Revocation is irreversible and customer-visible, so a reason is required in the UI (the API treats it as optional). */
export function validateRevokeReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length < 3) return "Vui lòng nhập lý do thu hồi (ít nhất 3 ký tự).";
  if (trimmed.length > 500) return "Lý do thu hồi tối đa 500 ký tự.";
  return null;
}
