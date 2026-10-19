export const RECONCILIATION_PAGE_SIZE = 20;

export type ReconciliationStatus = "OPEN" | "RESOLVED" | "DISMISSED";
export type ReconciliationReason = "AMOUNT_MISMATCH" | "UNKNOWN_TRANSFER_CODE" | "NO_TRANSFER_CODE";

export interface ProviderTransfer { id: string; amount: number; transferCode: string | null; occurredAt: string | null }

export interface ReconciliationCase {
  id: string;
  provider: string;
  externalEventId: string;
  reason: ReconciliationReason;
  status: ReconciliationStatus;
  paymentId: string | null;
  orderId: string | null;
  transferCode: string | null;
  expectedAmount: number | null;
  receivedAmount: number;
  difference: number | null;
  currency: string;
  lastRequery: { checkedAt: string; transfers: ProviderTransfer[]; totalReceived: number; matchesExpected: boolean } | null;
  lastRequeryAt: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface ReconciliationPage {
  items: ReconciliationCase[];
  total: number;
  openCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const RECONCILIATION_STATUS_FILTERS: ReadonlyArray<{ value: ReconciliationStatus | ""; label: string }> = [
  { value: "OPEN", label: "Chờ xử lý" },
  { value: "RESOLVED", label: "Đã xử lý" },
  { value: "DISMISSED", label: "Đã bỏ qua" },
  { value: "", label: "Tất cả" },
];

export const RECONCILIATION_REASONS: ReadonlyArray<{ value: ReconciliationReason | ""; label: string }> = [
  { value: "", label: "Mọi lý do" },
  { value: "AMOUNT_MISMATCH", label: "Lệch số tiền" },
  { value: "UNKNOWN_TRANSFER_CODE", label: "Mã chuyển khoản không khớp đơn nào" },
  { value: "NO_TRANSFER_CODE", label: "Không có mã chuyển khoản" },
];

export function reconciliationQuery(page: number, status: ReconciliationStatus | "", reason: ReconciliationReason | ""): string {
  const params = new URLSearchParams({
    page: String(Number.isSafeInteger(page) && page > 0 ? page : 1),
    limit: String(RECONCILIATION_PAGE_SIZE),
  });
  if (RECONCILIATION_STATUS_FILTERS.some(s => s.value === status) && status) params.set("status", status);
  if (reason && RECONCILIATION_REASONS.some(r => r.value === reason)) params.set("reason", reason);
  return params.toString();
}

export function parseReconciliationPage(data: unknown): ReconciliationPage {
  const v = data as Partial<ReconciliationPage> | null;
  if (
    !v || typeof v !== "object" || !Array.isArray(v.items) ||
    !Number.isSafeInteger(v.total) || !Number.isSafeInteger(v.openCount) ||
    !Number.isSafeInteger(v.page) || !Number.isSafeInteger(v.totalPages)
  ) {
    throw new Error("Invalid reconciliation response");
  }
  return v as ReconciliationPage;
}

export function reasonLabel(reason: string): string {
  return RECONCILIATION_REASONS.find(r => r.value === reason)?.label ?? reason;
}

export function statusLabel(status: string): string {
  return RECONCILIATION_STATUS_FILTERS.find(s => s.value === status)?.label ?? status;
}

/** "Thiếu 90.000 ₫" / "Thừa 10.000 ₫" / null when the order is unknown. */
export function differenceLabel(difference: number | null, currency = "VND"): string {
  if (difference === null) return "Không xác định đơn";
  if (difference === 0) return "Đủ";
  const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency }).format(Math.abs(difference));
  return (difference < 0 ? "Thiếu " : "Thừa ") + money;
}

export function formatMoney(amount: number | null, currency = "VND"): string {
  return amount === null ? "—" : new Intl.NumberFormat("vi-VN", { style: "currency", currency }).format(amount);
}

/** The API requires a note of at least 5 characters; mirror it so staff see the problem before sending. */
export function validateResolutionNote(note: string): string | null {
  const trimmed = note.trim();
  if (trimmed.length < 5) return "Vui lòng ghi chú cách xử lý (ít nhất 5 ký tự).";
  if (trimmed.length > 1000) return "Ghi chú tối đa 1000 ký tự.";
  return null;
}
