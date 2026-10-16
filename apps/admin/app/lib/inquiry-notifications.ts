import type { NotificationDto } from "@nexus/contracts";

export const INQUIRY_NOTIFICATION_TYPE = "SERVICE_INQUIRY_CREATED";
/** Most notices the banner lists; the rest are summarised as a count. */
export const MAX_BANNER_ITEMS = 5;

export interface InquiryNoticeSummary {
  items: NotificationDto[];
  /** Unread notices beyond the ones listed. */
  overflow: number;
}

/**
 * Keeps only unread new-inquiry notices, newest first. The banner is a pointer into the
 * inquiries queue, so anything else the user's inbox holds is ignored.
 */
export function summarizeInquiryNotices(list: NotificationDto[], max = MAX_BANNER_ITEMS): InquiryNoticeSummary {
  const unread = list
    .filter((n) => n.type === INQUIRY_NOTIFICATION_TYPE && !n.isRead)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return { items: unread.slice(0, max), overflow: Math.max(0, unread.length - max) };
}

/**
 * Notification links come from the server but are only ever followed inside this app, so
 * accept nothing but a same-app path ("/service-inquiries/…"), never an absolute URL.
 */
export function safeInquiryPath(actionUrl: string | null | undefined): string | null {
  if (!actionUrl || !actionUrl.startsWith("/service-inquiries")) return null;
  if (actionUrl.startsWith("//") || actionUrl.includes("\\") || /[\r\n]/.test(actionUrl)) return null;
  return actionUrl;
}
