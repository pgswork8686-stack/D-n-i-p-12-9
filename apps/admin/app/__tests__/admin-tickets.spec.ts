import {
  ADMIN_TICKET_PAGE_SIZE, adminTicketQuery, adminTicketSenderLabel,
  adminTicketStatusLabel, parseAdminTicketPage, validateAdminReply,
} from "../lib/admin-tickets";
import { adminErrorMessage } from "../lib/admin-http";

describe("AD15/AD16 Admin tickets helpers", () => {
  it("bounds paging and passes only recognized status filters", () => {
    expect(adminTicketQuery(2, "")).toBe("page=2&limit=" + ADMIN_TICKET_PAGE_SIZE);
    expect(adminTicketQuery(-1, "")).toBe("page=1&limit=" + ADMIN_TICKET_PAGE_SIZE);
    expect(adminTicketQuery(1, "WAITING_STAFF")).toContain("status=WAITING_STAFF");
    expect(adminTicketQuery(1, "HACKED" as any)).not.toContain("status=");
  });
  it("derives page count from the server total and rejects malformed lists", () => {
    expect(parseAdminTicketPage({ items: [], total: 41 }).totalPages).toBe(3);
    expect(parseAdminTicketPage({ items: [], total: 0 }).totalPages).toBe(1);
    expect(() => parseAdminTicketPage({ items: null, total: 1 })).toThrow();
    expect(() => parseAdminTicketPage({ items: [] })).toThrow();
    expect(() => parseAdminTicketPage({ items: [], total: -2 })).toThrow();
  });
  it("labels statuses and senders in Vietnamese, flagging internal notes", () => {
    expect(adminTicketStatusLabel("WAITING_STAFF")).toBe("Chờ phản hồi");
    expect(adminTicketStatusLabel("WAITING_CUSTOMER")).toBe("Đã phản hồi");
    expect(adminTicketSenderLabel("STAFF", true)).toBe("Ghi chú nội bộ");
    expect(adminTicketSenderLabel("CUSTOMER", false)).toBe("Khách hàng");
  });
  it("validates the reply body", () => {
    expect(validateAdminReply("   ")).not.toBeNull();
    expect(validateAdminReply("Xin chào")).toBeNull();
    expect(validateAdminReply("a".repeat(5001))).not.toBeNull();
  });
  it("maps HTTP failures to distinct Vietnamese messages", () => {
    expect(adminErrorMessage(401, "ticket")).toContain("hết hạn");
    expect(adminErrorMessage(403, "ticket")).toContain("403");
    expect(adminErrorMessage(404, "ticket")).toContain("Không tìm thấy");
    expect(adminErrorMessage(409, "ticket")).toContain("thay đổi");
    expect(adminErrorMessage(500, "ticket")).toContain("thử lại");
  });
});
