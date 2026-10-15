export type ServiceCatalogStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
export type ServicePricingMode = "QUOTE_REQUIRED" | "DIRECT_CHECKOUT";
export type ServiceInquiryStatus =
  | "NEW"
  | "REVIEWING"
  | "QUALIFIED"
  | "REJECTED"
  | "SPAM"
  | "CONVERTED";
export type ServiceProjectStatus =
  | "PLANNING"
  | "IN_PROGRESS"
  | "ON_HOLD"
  | "IN_REVIEW"
  | "COMPLETED"
  | "CANCELLED";
export type ServiceMilestoneStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "CANCELLED";
export type ServiceProjectMemberRole = "LEAD" | "MEMBER";
export type ServiceDocumentVisibility = "CUSTOMER" | "INTERNAL";
export type ServiceSenderType = "CUSTOMER" | "STAFF";
export type ServiceProjectEventType =
  | "CREATED"
  | "STATUS_CHANGED"
  | "MEMBER_ASSIGNED"
  | "MEMBER_REMOVED"
  | "MILESTONE_CREATED"
  | "MILESTONE_UPDATED"
  | "DOCUMENT_ADDED"
  | "MESSAGE_POSTED";

/** Allowed values for the optional budget field (VND). */
export const SERVICE_BUDGET_RANGES = [
  "UNDER_20M",
  "FROM_20M_TO_50M",
  "FROM_50M_TO_100M",
  "FROM_100M_TO_300M",
  "OVER_300M",
  "UNDECIDED",
] as const;
export type ServiceBudgetRange = (typeof SERVICE_BUDGET_RANGES)[number];

export const SERVICE_TIMELINES = [
  "ASAP",
  "WITHIN_1_MONTH",
  "ONE_TO_THREE_MONTHS",
  "THREE_TO_SIX_MONTHS",
  "FLEXIBLE",
] as const;
export type ServiceTimeline = (typeof SERVICE_TIMELINES)[number];

/** File rules for inquiry attachments and project documents. */
export const SERVICE_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const SERVICE_INQUIRY_MAX_FILES = 5;
export const SERVICE_FILE_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

export interface ServiceProcessStep {
  title: string;
  description: string;
}

export interface ServiceDto {
  id: string;
  slug: string;
  name: string;
  summary: string;
  description: string;
  features: string[];
  processSteps: ServiceProcessStep[];
  imageUrl: string | null;
  ctaLabel: string;
  pricingMode: ServicePricingMode;
  /** Catalog product to check out when pricingMode is DIRECT_CHECKOUT. */
  productSlug: string | null;
  status: ServiceCatalogStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateServiceRequest {
  slug: string;
  name: string;
  summary: string;
  description: string;
  features?: string[];
  processSteps?: ServiceProcessStep[];
  imageUrl?: string | null;
  ctaLabel?: string;
  pricingMode?: ServicePricingMode;
  productId?: string | null;
  status?: ServiceCatalogStatus;
  sortOrder?: number;
}

export type UpdateServiceRequest = Partial<CreateServiceRequest>;

export interface ServiceFileDto {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ServiceInquiryDto {
  id: string;
  inquiryNumber: string;
  service: { id: string; slug: string; name: string };
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  requirements: string;
  desiredFeatures: string[];
  budgetRange: ServiceBudgetRange | null;
  timeline: ServiceTimeline | null;
  status: ServiceInquiryStatus;
  attachments: ServiceFileDto[];
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Admin view adds review metadata and the submitting account. */
export interface AdminServiceInquiryDto extends ServiceInquiryDto {
  userId: string | null;
  staffNote: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
}

/** Public form payload, sent as multipart fields (attachments as `files`). */
export interface CreateServiceInquiryRequest {
  serviceSlug: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  requirements: string;
  desiredFeatures?: string[];
  budgetRange?: ServiceBudgetRange;
  timeline?: ServiceTimeline;
  /** Client-generated UUID; resubmitting returns the original inquiry. */
  submissionKey?: string;
  /** Honeypot field: must stay empty. */
  website?: string;
}

export interface CreateServiceInquiryResponse {
  inquiryNumber: string;
  status: ServiceInquiryStatus;
}

export interface AdminUpdateInquiryRequest {
  status?: ServiceInquiryStatus;
  staffNote?: string | null;
}

export interface ConvertInquiryRequest {
  title?: string;
  summary?: string;
  /**
   * Required when the inquiry was submitted anonymously: email of an existing
   * account that will own the project. Never inferred from the inquiry's own
   * (unverified) contact email.
   */
  customerEmail?: string;
  startDate?: string;
  targetDate?: string;
}

export interface ServiceProjectMemberDto {
  id: string;
  userId: string;
  displayName: string | null;
  email: string | null;
  role: ServiceProjectMemberRole;
  createdAt: string;
}

export interface ServiceMilestoneDto {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: ServiceMilestoneStatus;
  sortOrder: number;
  completedAt: string | null;
}

export interface ServiceProjectDocumentDto extends ServiceFileDto {
  visibility: ServiceDocumentVisibility;
  uploaderType: ServiceSenderType;
}

export interface ServiceProjectMessageDto {
  id: string;
  senderType: ServiceSenderType;
  senderName: string | null;
  isInternalNote: boolean;
  body: string;
  createdAt: string;
}

export interface ServiceProjectEventDto {
  id: string;
  type: ServiceProjectEventType;
  fromStatus: string | null;
  toStatus: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface ServiceProjectSummaryDto {
  id: string;
  projectCode: string;
  title: string;
  service: { id: string; slug: string; name: string };
  status: ServiceProjectStatus;
  startDate: string | null;
  targetDate: string | null;
  completedAt: string | null;
  milestoneProgress: { done: number; total: number };
  createdAt: string;
  updatedAt: string;
}

export interface ServiceProjectDto extends ServiceProjectSummaryDto {
  summary: string | null;
  inquiryNumber: string | null;
  members: ServiceProjectMemberDto[];
  milestones: ServiceMilestoneDto[];
  documents: ServiceProjectDocumentDto[];
  messages: ServiceProjectMessageDto[];
  events: ServiceProjectEventDto[];
}

export interface AdminServiceProjectDto extends ServiceProjectDto {
  customer: { id: string; email: string | null; displayName: string | null };
}

export interface AdminUpdateProjectRequest {
  title?: string;
  summary?: string | null;
  status?: ServiceProjectStatus;
  startDate?: string | null;
  targetDate?: string | null;
}

export interface AssignProjectMemberRequest {
  userId: string;
  role?: ServiceProjectMemberRole;
}

export interface CreateMilestoneRequest {
  title: string;
  description?: string;
  dueDate?: string;
  sortOrder?: number;
}

export interface UpdateMilestoneRequest {
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  status?: ServiceMilestoneStatus;
  sortOrder?: number;
}

export interface PostProjectMessageRequest {
  body: string;
  /** Staff only; ignored for customers. */
  isInternalNote?: boolean;
}

export interface ServiceFileDownloadResponse {
  url: string;
  expiresInSeconds: number;
}

export interface StaffUserDto {
  id: string;
  email: string | null;
  displayName: string | null;
  roles: string[];
}

export interface ServiceListQuery {
  status?: string;
  serviceId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedList<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
