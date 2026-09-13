import { prisma, OutboxEventStatus } from "@nexus/database";

export interface ProcessOutboxResult {
  processedCount: number;
  results: {
    id: string;
    eventType: string;
    aggregateId: string;
    status: OutboxEventStatus;
  }[];
}

/**
 * Processes pending outbox events from the database.
 * Strictly foundational logging in Phase 4:
 * NO entitlement creation (Phase 5)
 * NO license allocation (Phase 6)
 * NO license key generation (Phase 7)
 */
export async function processOutboxEvents(): Promise<ProcessOutboxResult> {
  const pendingEvents = await prisma.outboxEvent.findMany({
    where: { status: OutboxEventStatus.PENDING },
    orderBy: { createdAt: "asc" },
    take: 10,
  });

  const results: {
    id: string;
    eventType: string;
    aggregateId: string;
    status: OutboxEventStatus;
  }[] = [];

  for (const event of pendingEvents) {
    console.log(
      JSON.stringify({
        level: "info",
        service: "worker",
        event: "outbox_event_started",
        eventId: event.id,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        timestamp: new Date().toISOString(),
      }),
    );

    const updated = await prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: OutboxEventStatus.PROCESSED,
        processedAt: new Date(),
      },
    });

    console.log(
      JSON.stringify({
        level: "info",
        service: "worker",
        event: "outbox_event_processed",
        eventId: updated.id,
        eventType: updated.eventType,
        aggregateType: updated.aggregateType,
        aggregateId: updated.aggregateId,
        timestamp: updated.processedAt?.toISOString(),
      }),
    );

    results.push({
      id: updated.id,
      eventType: updated.eventType,
      aggregateId: updated.aggregateId,
      status: updated.status,
    });
  }

  return {
    processedCount: results.length,
    results,
  };
}
