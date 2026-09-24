import { TicketStatus, TicketPriority, TicketSenderType } from "@prisma/client";

/**
 * Valid state transitions for Support Tickets.
 */
const ALLOWED_TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: [
    TicketStatus.WAITING_STAFF,
    TicketStatus.WAITING_CUSTOMER,
    TicketStatus.IN_PROGRESS,
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
  ],
  WAITING_STAFF: [
    TicketStatus.IN_PROGRESS,
    TicketStatus.WAITING_CUSTOMER,
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
  ],
  IN_PROGRESS: [
    TicketStatus.WAITING_CUSTOMER,
    TicketStatus.WAITING_STAFF,
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
  ],
  WAITING_CUSTOMER: [
    TicketStatus.WAITING_STAFF,
    TicketStatus.IN_PROGRESS,
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
  ],
  RESOLVED: [
    TicketStatus.OPEN,
    TicketStatus.WAITING_STAFF,
    TicketStatus.IN_PROGRESS,
    TicketStatus.CLOSED,
  ],
  CLOSED: [
    TicketStatus.OPEN, // Reopening allowed
  ],
};

/**
 * Validates forward or reopen lifecycle transitions for tickets.
 */
export function isValidTicketTransition(
  from: TicketStatus,
  to: TicketStatus,
): boolean {
  if (from === to) return true;
  const allowed = ALLOWED_TICKET_TRANSITIONS[from];
  return Boolean(allowed && allowed.includes(to));
}

/**
 * Determines new ticket status upon a message reply.
 * - Customer reply moves ticket to WAITING_STAFF (or reopens if resolved/closed).
 * - Staff reply (public) moves ticket to WAITING_CUSTOMER.
 * - Staff internal note does NOT change public ticket status.
 */
export function determineStatusOnReply(
  currentStatus: TicketStatus,
  senderType: TicketSenderType,
  isInternalNote: boolean,
): TicketStatus {
  if (isInternalNote) {
    return currentStatus;
  }

  if (senderType === TicketSenderType.CUSTOMER) {
    if (currentStatus === TicketStatus.RESOLVED || currentStatus === TicketStatus.CLOSED) {
      return TicketStatus.OPEN;
    }
    return TicketStatus.WAITING_STAFF;
  }

  if (senderType === TicketSenderType.STAFF) {
    return TicketStatus.WAITING_CUSTOMER;
  }

  return currentStatus;
}

/**
 * Strips internal staff notes from message list before sending to customer.
 * Security gate: Customers MUST NEVER see staff internal notes.
 */
export function filterMessagesForCustomer<T extends { isInternalNote: boolean }>(
  messages: T[],
): T[] {
  return messages.filter((m) => !m.isInternalNote);
}

/**
 * Checks if a ticket should be automatically closed due to inactivity.
 * By default, tickets in WAITING_CUSTOMER or RESOLVED for > 7 days are auto-closed.
 */
export function shouldAutoCloseTicket(
  status: TicketStatus,
  lastActivityAt: Date,
  autoCloseDays = 7,
): boolean {
  if (status !== TicketStatus.WAITING_CUSTOMER && status !== TicketStatus.RESOLVED) {
    return false;
  }

  const cutoff = new Date(Date.now() - autoCloseDays * 24 * 60 * 60 * 1000);
  return lastActivityAt < cutoff;
}

/**
 * Target SLA first-response turnaround in hours based on priority.
 */
export const SLA_TARGET_HOURS: Record<TicketPriority, number> = {
  URGENT: 2,
  HIGH: 6,
  NORMAL: 24,
  MEDIUM: 24,
  LOW: 48,
};

/**
 * Evaluates whether a ticket response breached target SLA.
 */
export function isSlaBreached(
  ticketCreatedAt: Date,
  firstResponseAt: Date | null,
  priority: TicketPriority,
): boolean {
  const maxMs = SLA_TARGET_HOURS[priority] * 60 * 60 * 1000;
  const targetDeadline = new Date(ticketCreatedAt.getTime() + maxMs);
  const evaluatedAt = firstResponseAt || new Date();
  return evaluatedAt > targetDeadline;
}

/**
 * Verifies if user has authority to access ticket.
 * Zero-client authority and anti-enumeration: Customer only accesses own ticket.
 */
export function canUserAccessTicket(
  ticketUserId: string,
  requestingUserId: string,
  isAdminOrStaff = false,
): boolean {
  if (isAdminOrStaff) return true;
  return ticketUserId === requestingUserId;
}
