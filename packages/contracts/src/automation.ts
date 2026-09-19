export type AutomationJobStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export type AutomationJobType =
  | "CMS_AI_DRAFT"
  | "ORDER_PAID_EMAIL"
  | "LICENSE_PROVISIONED_EMAIL"
  | "EXTERNAL_ALLOCATION_EMAIL";

export type AutomationDeliveryStatus =
  | "PENDING"
  | "SENDING"
  | "SENT"
  | "FAILED";

export interface AutomationJobDto {
  id: string;
  type: AutomationJobType;
  status: AutomationJobStatus;
  sourceType?: string | null;
  sourceId?: string | null;
  idempotencyKey: string;
  payloadJson: any;
  resultJson?: any;
  attemptCount: number;
  maxAttempts: number;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  scheduledAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  leaseUntil?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAiDraftJobDto {
  topic: string;
  brief: string;
  language: string;
  targetKeyword?: string;
  tone?: string;
  desiredLength?: string;
}

export interface AiDraftOutputContract {
  title: string;
  excerpt: string;
  content: string;
  seoTitle: string;
  seoDescription: string;
  suggestedSlug: string;
}

export interface AutomationCallbackCompleteDto {
  jobId: string;
  resultJson?: any;
  providerMessageId?: string;
}

export interface AutomationDeliveryDto {
  id: string;
  jobId?: string | null;
  recipientEmail: string;
  template: string;
  idempotencyKey: string;
  status: AutomationDeliveryStatus;
  payloadJson?: any;
  providerMessageId?: string | null;
  sentAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationCallbackFailDto {
  jobId: string;
  errorCode: string;
  errorMessage: string;
  retryable?: boolean;
}

export interface AutomationCallbackAiDraftResultDto {
  jobId: string;
  result: AiDraftOutputContract;
}

export interface ListAutomationJobsQuery {
  status?: AutomationJobStatus;
  type?: AutomationJobType;
  page?: number;
  limit?: number;
}

export interface PaginatedAutomationJobsDto {
  items: AutomationJobDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
