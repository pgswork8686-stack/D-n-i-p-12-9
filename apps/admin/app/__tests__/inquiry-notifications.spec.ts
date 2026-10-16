import type { NotificationDto } from "@nexus/contracts";
import { MAX_BANNER_ITEMS, safeInquiryPath, summarizeInquiryNotices } from "../lib/inquiry-notifications";

const n = (over: Partial<NotificationDto>): NotificationDto => ({
  id: "n",
  userId: "u",
  type: "SERVICE_INQUIRY_CREATED",
  title: "t",
  message: "m",
  actionUrl: "/service-inquiries/1",
  isRead: false,
  createdAt: "2026-10-16T01:00:00.000Z",
  ...over,
} as NotificationDto);

describe("summarizeInquiryNotices", () => {
  it("lists only unread new-inquiry notices, newest first", () => {
    const res = summarizeInquiryNotices([
      n({ id: "old", createdAt: "2026-10-16T01:00:00.000Z" }),
      n({ id: "new", createdAt: "2026-10-16T03:00:00.000Z" }),
      n({ id: "read", isRead: true }),
      n({ id: "ticket", type: "TICKET_CREATED" }),
    ]);
    expect(res.items.map((i) => i.id)).toEqual(["new", "old"]);
    expect(res.overflow).toBe(0);
  });

  it("bounds the list and reports the overflow instead of rendering an unbounded banner", () => {
    const many = Array.from({ length: MAX_BANNER_ITEMS + 4 }, (_, i) => n({ id: `n${i}`, createdAt: new Date(2026, 9, 16, 1, i).toISOString() }));
    const res = summarizeInquiryNotices(many);
    expect(res.items).toHaveLength(MAX_BANNER_ITEMS);
    expect(res.overflow).toBe(4);
  });
});

describe("safeInquiryPath", () => {
  it("accepts in-app inquiry paths only", () => {
    expect(safeInquiryPath("/service-inquiries/abc")).toBe("/service-inquiries/abc");
    for (const bad of [null, undefined, "", "https://evil.example/service-inquiries/1", "//evil.example", "/other", "/service-inquiries\\x", "javascript:alert(1)"]) {
      expect(safeInquiryPath(bad as any)).toBeNull();
    }
  });
});
