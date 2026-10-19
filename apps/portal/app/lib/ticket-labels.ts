import type { TicketPriority } from "@nexus/contracts";

export const TICKET_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "ALL", label: "Tất cả" },
  { value: "OPEN", label: "Đang mở" },
  { value: "WAITING_CUSTOMER", label: "Chờ bạn phản hồi" },
  { value: "WAITING_STAFF", label: "Chờ nhân viên" },
  { value: "RESOLVED", label: "Đã giải quyết" },
  { value: "CLOSED", label: "Đã đóng" },
];

const PRIORITY: Record<string, string> = { LOW: "Thấp", NORMAL: "Bình thường", HIGH: "Cao", URGENT: "Khẩn cấp" };
const CATEGORY: Record<string, string> = {
  GENERAL: "Chung", TECHNICAL: "Kỹ thuật", HOSTING: "Hosting", BILLING: "Thanh toán", LICENSING: "License",
};

export const priorityLabel = (p: TicketPriority | string) => PRIORITY[p] ?? String(p);
export const categoryLabel = (c?: string | null) => (c ? CATEGORY[c] ?? c : "—");
