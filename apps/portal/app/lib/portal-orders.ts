import type { OrderDto, OrderStatus } from "@nexus/contracts";

export const ORDER_STATUS_FILTERS: ReadonlyArray<{ value: OrderStatus | ""; label: string }> = [
  { value: "", label: "Trạng thái: Tất cả" },
  { value: "PENDING_PAYMENT", label: "Chờ thanh toán" },
  { value: "PAID", label: "Đã thanh toán" },
  { value: "CANCELLED", label: "Đã hủy" },
];

/** Client-side filter over the orders already loaded; matches the order number only. */
export function filterOrders(orders: OrderDto[], status: OrderStatus | "", search: string): OrderDto[] {
  const needle = search.trim().toLowerCase();
  return orders.filter(order => {
    if (status && order.status !== status) return false;
    return !needle || order.orderNumber.toLowerCase().includes(needle);
  });
}

export const ORDER_PAGE_SIZE = 20;

export interface Paged<T> { items: T[]; page: number; totalPages: number; total: number }

/** Clamps the requested page into range so a shrinking list never shows an empty page. */
export function paginate<T>(list: T[], page: number, size = ORDER_PAGE_SIZE): Paged<T> {
  const totalPages = Math.max(1, Math.ceil(list.length / size));
  const safe = Math.min(Math.max(1, Number.isSafeInteger(page) ? page : 1), totalPages);
  return { items: list.slice((safe - 1) * size, safe * size), page: safe, totalPages, total: list.length };
}

/** "KlinMart (1 website), FlowPOS UI Kit" — product and plan names exactly as snapshotted on the order. */
export function orderProductSummary(order: OrderDto): string {
  const lines = (order.items ?? []).map(item => item.productName + (item.variantName && item.variantName !== item.productName ? ` (${item.variantName})` : ""));
  return lines.length ? lines.join(", ") : "—";
}

/** Payment provider code → customer-facing name; unknown providers are shown as-is. */
export function paymentProviderLabel(provider?: string | null): string {
  const p = String(provider ?? "").toLowerCase();
  if (!p) return "—";
  if (p.includes("sepay") || p.includes("vietqr")) return "Chuyển khoản VietQR";
  if (p.includes("stripe")) return "Thẻ quốc tế (Stripe)";
  return String(provider);
}

/** The succeeded payment, if any — the only thing that proves the order was paid. */
export function succeededPayment(order: OrderDto) {
  return (order.payments ?? []).find(payment => payment.status === "SUCCEEDED") ?? null;
}

/** 360 → "12 tháng"; null/undefined/0 → null so callers can omit the phrase. */
export function monthsLabel(days?: number | null): string | null {
  if (!days || days <= 0) return null;
  return Math.max(1, Math.round(days / 30)) + " tháng";
}

/** "Gói 1 website · cập nhật 12 tháng · hỗ trợ 6 tháng", built only from fields that exist on the snapshot. */
export function itemEntitlementSummary(item: OrderDto["items"][number]): string {
  const parts: string[] = [];
  if (item.variantName && item.variantName !== item.productName) parts.push("Gói " + item.variantName);
  if (item.isLifetime) parts.push("trọn đời");
  const updates = monthsLabel(item.updatesDays);
  const support = monthsLabel(item.supportDays);
  if (updates) parts.push("cập nhật " + updates);
  if (support) parts.push("hỗ trợ " + support);
  return parts.join(" · ") || "—";
}

export function formatViDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("vi-VN");
}

export function formatViTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}
