import {
  prisma,
  TicketStatus,
  TicketSenderType,
  NotificationType,
  shouldAutoCloseTicket,
} from "@nexus/database";

export interface TicketWorkerOptions {
  batchSize?: number;
  workerId?: string;
  autoCloseDays?: number;
}

/**
 * Handles TICKET_CREATED outbox event:
 * - Alerts support agents or enqueues webhook/automation if configured.
 */
export async function processTicketCreatedEvent(
  payload: any,
  workerId = "worker-default",
) {
  const { ticketId, ticketNumber, userId, subject, category, priority } = payload;
  console.log(
    JSON.stringify({
      level: "info",
      service: "worker",
      event: "ticket_created_notification",
      workerId,
      ticketId,
      ticketNumber,
      userId,
      subject,
      category,
      priority,
      timestamp: new Date().toISOString(),
    }),
  );

  return { handled: true, ticketNumber };
}

/**
 * Handles TICKET_REPLIED outbox event:
 * - Logs and coordinates email or webhook triggers for customer or staff.
 */
export async function processTicketRepliedEvent(
  payload: any,
  workerId = "worker-default",
) {
  const { ticketId, ticketNumber, messageId, senderId, senderType, isInternalNote, newStatus } = payload;
  console.log(
    JSON.stringify({
      level: "info",
      service: "worker",
      event: "ticket_replied_notification",
      workerId,
      ticketId,
      ticketNumber,
      messageId,
      senderId,
      senderType,
      isInternalNote,
      newStatus,
      timestamp: new Date().toISOString(),
    }),
  );

  return { handled: true, ticketNumber };
}

/**
 * Authoritative periodic reconciliation for idle tickets:
 * Tickets in WAITING_CUSTOMER or RESOLVED that have had no activity for >= autoCloseDays (default 7)
 * are transitioned to CLOSED.
 */
export async function reconcileIdleTickets(
  options: TicketWorkerOptions = {},
): Promise<{ closedCount: number; ticketIds: string[] }> {
  const workerId = options.workerId || "worker-default";
  const autoCloseDays = options.autoCloseDays || 7;
  const batchSize = options.batchSize || 50;

  const cutoff = new Date(Date.now() - autoCloseDays * 24 * 60 * 60 * 1000);

  const idleTickets = await prisma.ticket.findMany({
    where: {
      status: {
        in: [TicketStatus.WAITING_CUSTOMER, TicketStatus.RESOLVED],
      },
      updatedAt: {
        lte: cutoff,
      },
    },
    take: batchSize,
  });

  if (!idleTickets || idleTickets.length === 0) {
    return { closedCount: 0, ticketIds: [] };
  }

  const closedIds: string[] = [];

  for (const ticket of idleTickets) {
    if (!shouldAutoCloseTicket(ticket.status, ticket.updatedAt, autoCloseDays)) {
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.ticket.update({
          where: { id: ticket.id },
          data: {
            status: TicketStatus.CLOSED,
            closedAt: new Date(),
            updatedAt: new Date(),
          },
        });

        await tx.ticketMessage.create({
          data: {
            ticketId: ticket.id,
            senderId: "SYSTEM",
            senderType: TicketSenderType.SYSTEM,
            isInternalNote: false,
            body: `This ticket was automatically closed following ${autoCloseDays} days of inactivity. If you still need help, feel free to reply to reopen or create a new ticket.`,
          },
        });

        await tx.notification.create({
          data: {
            userId: ticket.userId,
            type: NotificationType.TICKET_CLOSED,
            title: `Ticket #${ticket.ticketNumber} closed due to inactivity`,
            message: `Your ticket #${ticket.ticketNumber} was automatically closed after ${autoCloseDays} days.`,
            actionUrl: `/tickets/${ticket.id}`,
            isRead: false,
          },
        });

        await tx.outboxEvent.create({
          data: {
            eventType: "TICKET_STATUS_CHANGED",
            aggregateType: "Ticket",
            aggregateId: ticket.id,
            payload: {
              ticketId: ticket.id,
              ticketNumber: ticket.ticketNumber,
              oldStatus: ticket.status,
              newStatus: TicketStatus.CLOSED,
              reason: "AUTO_CLOSE_INACTIVITY",
            },
            status: "PENDING",
          },
        });
      });

      closedIds.push(ticket.id);
      console.log(
        JSON.stringify({
          level: "info",
          service: "worker",
          event: "ticket_auto_closed",
          workerId,
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          inactivityDays: autoCloseDays,
          timestamp: new Date().toISOString(),
        }),
      );
    } catch (err: any) {
      console.error(
        JSON.stringify({
          level: "error",
          service: "worker",
          event: "ticket_auto_close_failed",
          workerId,
          ticketId: ticket.id,
          error: err?.message || String(err),
          timestamp: new Date().toISOString(),
        }),
      );
    }
  }

  return { closedCount: closedIds.length, ticketIds: closedIds };
}
