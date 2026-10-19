import type {
  TicketDto,
  TicketPriority,
  TicketSenderType,
  TicketStatus,
} from "@nexus/contracts";

export const ADMIN_TICKET_PAGE_SIZE = 20;

export const ADMIN_TICKET_STATUSES: ReadonlyArray<{ value: TicketStatus | ""; label: string }> = [
  { value: "", label: "Tất cả" },
  { value: "WAITING_STAFF", label: "Chờ phản hồi" },
  { value: "IN_PROGRESS", label: "Đang xử lý" },
  { value: "WAITING_CUSTOMER", label: "Đã phản hồi" },
  { value: "OPEN", label: "Mới mở" },
  { value: "RESOLVED", label: "Đã giải quyết" },
  { value: "CLOSED", label: "Đã đóng" },
];

export const ADMIN_TICKET_PRIORITIES: ReadonlyArray<{ value: TicketPriority; label: string }> = [
  { value: "LOW", label: "Thấp" },
  { value: "NORMAL", label: "Bình thường" },
  { value: "MEDIUM", label: "Trung bình" },
  { value: "HIGH", label: "Cao" },
  { value: "URGENT", label: "Khẩn cấp" },
];

const STATUS_VALUES = new Set(ADMIN_TICKET_STATUSES.map(item => item.value).filter(Boolean));

export function adminTicketQuery(page: number, status: TicketStatus | ""): string {
  const validPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const params = new URLSearchParams({
    page: String(validPage),
    limit: String(ADMIN_TICKET_PAGE_SIZE),
  });
  if (status && STATUS_VALUES.has(status)) params.set("status", status);
  return params.toString();
}

export interface AdminTicketPage {
  items: TicketDto[];
  total: number;
  totalPages: number;
}

/** The API returns { items, total }; derive totalPages without inventing a total. */
export function parseAdminTicketPage(data: unknown): AdminTicketPage {
  if (!data || typeof data !== "object") throw new Error("Invalid ticket response");
  const value = data as { items?: unknown; total?: unknown };
  if (!Array.isArray(value.items) || !Number.isSafeInteger(value.total) || (value.total as number) < 0) {
    throw new Error("Invalid ticket list response");
  }
  const total = value.total as number;
  return {
    items: value.items as TicketDto[],
    total,
    totalPages: Math.max(1, Math.ceil(total / ADMIN_TICKET_PAGE_SIZE)),
  };
}

export function adminTicketStatusLabel(status: TicketStatus): string {
  return ADMIN_TICKET_STATUSES.find(item => item.value === status)?.label || status;
}

export function adminTicketPriorityLabel(priority: TicketPriority): string {
  return ADMIN_TICKET_PRIORITIES.find(item => item.value === priority)?.label || priority;
}

export function adminTicketSenderLabel(sender: TicketSenderType, internal: boolean): string {
  if (internal) return "Ghi chú nội bộ";
  return sender === "STAFF" ? "Nhân viên" : sender === "CUSTOMER" ? "Khách hàng" : "Hệ thống";
}

/** UI guard only: the API requires a non-empty body; the 5,000-character cap is a UI choice. */
export function validateAdminReply(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) return "Vui lòng nhập nội dung phản hồi.";
  if (trimmed.length > 5000) return "Nội dung phản hồi tối đa 5.000 ký tự.";
  return null;
}
