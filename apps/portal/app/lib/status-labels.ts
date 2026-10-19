export type StatusTone = "success" | "warning" | "error" | "info";
export type StatusKind = "order" | "entitlement" | "license" | "allocation" | "ticket";

export interface StatusPresentation {
  label: string;
  tone: StatusTone;
  /** Non-color cue (WCAG 1.4.1): ✓ ok, ! needs attention, ✕ failed/denied, ● in progress, ○ closed/neutral. */
  glyph: string;
}

const OK = (label: string): StatusPresentation => ({ label, tone: "success", glyph: "✓" });
const WARN = (label: string): StatusPresentation => ({ label, tone: "warning", glyph: "!" });
const BAD = (label: string): StatusPresentation => ({ label, tone: "error", glyph: "✕" });
const LIVE = (label: string): StatusPresentation => ({ label, tone: "info", glyph: "●" });
const DONE = (label: string): StatusPresentation => ({ label, tone: "info", glyph: "○" });

/** Status codes shared by every portal module, in the wording used by the Figma design. */
const STATUS: Record<string, StatusPresentation> = {
  // orders and payments
  PENDING_PAYMENT: WARN("Chờ thanh toán"),
  PAID: OK("Đã thanh toán"),
  CANCELLED: DONE("Đã hủy"),
  CANCELED: DONE("Đã hủy"),
  SUCCEEDED: OK("Thành công"),
  FAILED: BAD("Thất bại"),
  // entitlements and licenses
  ACTIVE: OK("Hoạt động"),
  REVOKED: BAD("Đã thu hồi"),
  EXPIRED: DONE("Hết hạn"),
  // managed-license allocations
  PENDING: WARN("Chờ xác nhận"),
  DEACTIVATION_PENDING: WARN("Chờ hủy kích hoạt"),
  DEACTIVATION_REQUESTED: WARN("Chờ hủy kích hoạt"),
  DEACTIVATED: DONE("Đã hủy kích hoạt"),
  REJECTED: BAD("Bị từ chối"),
  // support tickets
  OPEN: LIVE("Mới mở"),
  WAITING_CUSTOMER: LIVE("Đã phản hồi"),
  WAITING_STAFF: WARN("Đang chờ nhân viên"),
  IN_PROGRESS: WARN("Đang xử lý"),
  RESOLVED: OK("Đã giải quyết"),
  CLOSED: DONE("Đã đóng"),
  // publishing, billing, hosting, membership
  PUBLISHED: OK("Đã phát hành"),
  DRAFT: WARN("Nháp"),
  PROCESSING: WARN("Đang xử lý"),
  ARCHIVED: DONE("Đã lưu trữ"),
  SUSPENDED: BAD("Tạm ngưng"),
  TERMINATED: BAD("Đã chấm dứt"),
  PROVISIONING: LIVE("Đang khởi tạo"),
  PAST_DUE: WARN("Quá hạn"),
  OVERDUE: WARN("Quá hạn"),
  UNPAID: WARN("Chưa thanh toán"),
  VOID: DONE("Đã hủy"),
  APPROVED: OK("Đã duyệt"),
};

const BY_KIND: Partial<Record<StatusKind, Record<string, StatusPresentation>>> = {
  // Figma: entitlements read "Đang hiệu lực", licenses read "Hoạt động".
  entitlement: { ACTIVE: OK("Đang hiệu lực") },
};

/** Never invents a Vietnamese label for an unknown code: it shows the code itself. */
export function statusPresentation(status: string, kind?: StatusKind): StatusPresentation {
  const key = String(status ?? "").toUpperCase();
  return (kind && BY_KIND[kind]?.[key]) || STATUS[key] || { label: String(status ?? "—"), tone: "info", glyph: "●" };
}
