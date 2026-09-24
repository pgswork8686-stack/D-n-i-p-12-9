export type TicketPriority = "LOW" | "NORMAL" | "MEDIUM" | "HIGH" | "URGENT";
export type TicketStatus =
  | "OPEN"
  | "WAITING_CUSTOMER"
  | "WAITING_STAFF"
  | "IN_PROGRESS"
  | "RESOLVED"
  | "CLOSED";
export type TicketSenderType = "CUSTOMER" | "STAFF" | "SYSTEM";
export type NotificationType =
  | "ORDER_CONFIRMED"
  | "LICENSE_EXPIRING"
  | "TICKET_UPDATE"
  | "SECURITY_ALERT"
  | "SYSTEM_ANNOUNCEMENT"
  | "TICKET_CREATED"
  | "TICKET_REPLIED"
  | "TICKET_RESOLVED"
  | "TICKET_CLOSED"
  | "SYSTEM_ALERT"
  | "PROMOTION"
  | "BILLING";

export interface TicketAttachmentDto {
  id: string;
  messageId: string;
  fileName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256?: string | null;
  createdAt: string;
}

export interface TicketMessageDto {
  id: string;
  ticketId: string;
  senderId: string;
  senderType: TicketSenderType;
  isInternalNote: boolean;
  body: string;
  attachments?: TicketAttachmentDto[];
  createdAt: string;
}

export interface TicketDto {
  id: string;
  ticketNumber: string;
  userId: string;
  assignedAdminId?: string | null;
  subject: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  orderId?: string | null;
  entitlementId?: string | null;
  messages?: TicketMessageDto[];
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
}

export interface NotificationDto {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  actionUrl?: string | null;
  isRead: boolean;
  readAt?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface CreateTicketRequest {
  subject: string;
  body: string;
  category: string;
  priority?: TicketPriority;
  orderId?: string;
  entitlementId?: string;
  attachments?: {
    fileName: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    sha256?: string;
  }[];
}

export interface ReplyTicketRequest {
  body: string;
  isInternalNote?: boolean;
  attachments?: {
    fileName: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    sha256?: string;
  }[];
}

export interface AdminUpdateTicketRequest {
  assignedAdminId?: string | null;
  status?: TicketStatus;
  priority?: TicketPriority;
}

export interface QueryTicketsRequest {
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: string;
  userId?: string;
  assignedAdminId?: string;
  page?: number;
  limit?: number;
}

export interface QueryNotificationsRequest {
  isRead?: boolean;
  limit?: number;
}

export interface UnreadNotificationCountDto {
  count: number;
}
