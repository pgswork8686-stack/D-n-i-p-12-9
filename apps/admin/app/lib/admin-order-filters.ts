import type { OrderDto, OrderStatus, PaginatedResponse } from "@nexus/contracts";

export const ADMIN_ORDER_PAGE_SIZE = 20;

export const ADMIN_ORDER_STATUSES: ReadonlyArray<{ value: OrderStatus | ""; label: string }> = [
  { value: "", label: "Tất cả trạng thái" },
  { value: "PENDING_PAYMENT", label: "Chờ thanh toán" },
  { value: "PAID", label: "Đã thanh toán" },
  { value: "CANCELLED", label: "Đã huỷ" },
];

export function adminOrderQuery(page: number, status: OrderStatus | ""): string {
  const validPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const params = new URLSearchParams({
    page: String(validPage),
    limit: String(ADMIN_ORDER_PAGE_SIZE),
  });
  if (status && ADMIN_ORDER_STATUSES.some(item => item.value === status)) {
    params.set("status", status);
  }
  return params.toString();
}

export function parseAdminOrderPage(data: unknown): PaginatedResponse<OrderDto> {
  if (!data || typeof data !== "object") throw new Error("Invalid order response");
  const value = data as Partial<PaginatedResponse<OrderDto>>;
  if (
    !Array.isArray(value.items) ||
    !Number.isSafeInteger(value.total) || (value.total ?? -1) < 0 ||
    !Number.isSafeInteger(value.page) || (value.page ?? 0) < 1 ||
    !Number.isSafeInteger(value.limit) || (value.limit ?? 0) < 1 ||
    !Number.isSafeInteger(value.totalPages) || (value.totalPages ?? 0) < 1
  ) {
    throw new Error("Invalid paginated order response");
  }
  return value as PaginatedResponse<OrderDto>;
}

export function adminOrderStatusLabel(status: OrderStatus): string {
  return ADMIN_ORDER_STATUSES.find(item => item.value === status)?.label || status;
}
