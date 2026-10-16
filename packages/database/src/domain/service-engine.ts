import {
  ServiceInquiryStatus,
  ServiceProjectStatus,
  ServiceMilestoneStatus,
  ServiceDocumentVisibility,
} from "@prisma/client";

/**
 * Inquiry lifecycle. CONVERTED is terminal and only reachable through
 * conversion into a project (never through a plain status update).
 */
const ALLOWED_INQUIRY_TRANSITIONS: Record<ServiceInquiryStatus, ServiceInquiryStatus[]> = {
  NEW: [ServiceInquiryStatus.REVIEWING, ServiceInquiryStatus.QUALIFIED, ServiceInquiryStatus.REJECTED, ServiceInquiryStatus.SPAM],
  REVIEWING: [ServiceInquiryStatus.QUALIFIED, ServiceInquiryStatus.REJECTED, ServiceInquiryStatus.SPAM],
  QUALIFIED: [ServiceInquiryStatus.REVIEWING, ServiceInquiryStatus.REJECTED, ServiceInquiryStatus.CONVERTED],
  REJECTED: [ServiceInquiryStatus.REVIEWING],
  SPAM: [ServiceInquiryStatus.REVIEWING],
  CONVERTED: [],
};

export function isValidInquiryTransition(
  from: ServiceInquiryStatus,
  to: ServiceInquiryStatus,
): boolean {
  if (from === to) return true;
  return ALLOWED_INQUIRY_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Status changes an admin may request directly; CONVERTED requires the convert action. */
export function isManualInquiryTransition(
  from: ServiceInquiryStatus,
  to: ServiceInquiryStatus,
): boolean {
  return to !== ServiceInquiryStatus.CONVERTED && isValidInquiryTransition(from, to);
}

/** Only a qualified inquiry can become a project. */
export function canConvertInquiry(status: ServiceInquiryStatus): boolean {
  return status === ServiceInquiryStatus.QUALIFIED;
}

const ALLOWED_PROJECT_TRANSITIONS: Record<ServiceProjectStatus, ServiceProjectStatus[]> = {
  PLANNING: [ServiceProjectStatus.IN_PROGRESS, ServiceProjectStatus.ON_HOLD, ServiceProjectStatus.CANCELLED],
  IN_PROGRESS: [ServiceProjectStatus.ON_HOLD, ServiceProjectStatus.IN_REVIEW, ServiceProjectStatus.CANCELLED],
  ON_HOLD: [ServiceProjectStatus.PLANNING, ServiceProjectStatus.IN_PROGRESS, ServiceProjectStatus.CANCELLED],
  IN_REVIEW: [ServiceProjectStatus.IN_PROGRESS, ServiceProjectStatus.COMPLETED, ServiceProjectStatus.ON_HOLD],
  COMPLETED: [],
  CANCELLED: [],
};

export function isValidProjectTransition(
  from: ServiceProjectStatus,
  to: ServiceProjectStatus,
): boolean {
  if (from === to) return true;
  return ALLOWED_PROJECT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isProjectClosed(status: ServiceProjectStatus): boolean {
  return status === ServiceProjectStatus.COMPLETED || status === ServiceProjectStatus.CANCELLED;
}

const ALLOWED_MILESTONE_TRANSITIONS: Record<ServiceMilestoneStatus, ServiceMilestoneStatus[]> = {
  PENDING: [ServiceMilestoneStatus.IN_PROGRESS, ServiceMilestoneStatus.DONE, ServiceMilestoneStatus.CANCELLED],
  IN_PROGRESS: [ServiceMilestoneStatus.PENDING, ServiceMilestoneStatus.DONE, ServiceMilestoneStatus.CANCELLED],
  DONE: [ServiceMilestoneStatus.IN_PROGRESS],
  CANCELLED: [ServiceMilestoneStatus.PENDING],
};

export function isValidMilestoneTransition(
  from: ServiceMilestoneStatus,
  to: ServiceMilestoneStatus,
): boolean {
  if (from === to) return true;
  return ALLOWED_MILESTONE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Customers only ever see documents explicitly shared with them. */
export function isDocumentVisibleToCustomer(visibility: ServiceDocumentVisibility): boolean {
  return visibility === ServiceDocumentVisibility.CUSTOMER;
}

/** Ownership check shared by every customer-facing read and write. */
export function canCustomerAccessProject(
  project: { customerId: string } | null | undefined,
  userId: string,
): boolean {
  return Boolean(project && userId && project.customerId === userId);
}

export function canCustomerAccessInquiry(
  inquiry: { userId: string | null } | null | undefined,
  userId: string,
): boolean {
  return Boolean(inquiry && userId && inquiry.userId === userId);
}
