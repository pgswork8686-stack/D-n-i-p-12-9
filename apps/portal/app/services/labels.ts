import type {
  ServiceInquiryStatus,
  ServiceMilestoneStatus,
  ServiceProjectEventType,
  ServiceProjectStatus,
} from "@nexus/contracts";

/** Customer-facing wording: SPAM is never shown as such. */
export const INQUIRY_STATUS_LABELS: Record<ServiceInquiryStatus, string> = {
  NEW: "Received",
  REVIEWING: "In review",
  QUALIFIED: "Accepted",
  REJECTED: "Declined",
  SPAM: "In review",
  CONVERTED: "Project created",
};

export const PROJECT_STATUS_LABELS: Record<ServiceProjectStatus, string> = {
  PLANNING: "Planning",
  IN_PROGRESS: "In progress",
  ON_HOLD: "On hold",
  IN_REVIEW: "In review",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const MILESTONE_STATUS_LABELS: Record<ServiceMilestoneStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

export const EVENT_LABELS: Record<ServiceProjectEventType, string> = {
  CREATED: "Project created",
  STATUS_CHANGED: "Status changed",
  MEMBER_ASSIGNED: "Team member assigned",
  MEMBER_REMOVED: "Team member removed",
  MILESTONE_CREATED: "Milestone added",
  MILESTONE_UPDATED: "Milestone updated",
  DOCUMENT_ADDED: "Document shared",
  MESSAGE_POSTED: "New message",
};

export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
