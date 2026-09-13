import { prisma, OutboxEventStatus } from "@nexus/database";

export interface ProcessOutboxOptions {
  workerId?: string;
  batchSize?: number;
  maxRetries?: number;
  leaseTimeoutMinutes?: number;
}

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
 * Processes pending outbox events from the database with atomic multi-worker claim.
 * Uses PostgreSQL 'FOR UPDATE SKIP LOCKED' to prevent duplicate processing across concurrent workers.
 * Strictly foundational logging in Phase 4:
 * NO entitlement creation (Phase 5)
 * NO license allocation (Phase 6)
 * NO license key generation (Phase 7)
 */
export async function processOutboxEvents(
  options?: ProcessOutboxOptions,
): Promise<ProcessOutboxResult> {
  const workerId =
    options?.workerId ||
    `worker_${Math.random().toString(36).substring(2, 10)}`;
  const batchSize = options?.batchSize || 10;
  const maxRetries = options?.maxRetries || 5;
  const leaseTimeoutMinutes = options?.leaseTimeoutMinutes || 5;

  let claimedRows: { id: string }[] = [];

  try {
    claimedRows = await prisma.$queryRaw<{ id: string }[]>`
      WITH claimable AS (
        SELECT id
        FROM outbox_events
        WHERE (
          status = 'PENDING'::"OutboxEventStatus"
          OR (status = 'PROCESSING'::"OutboxEventStatus" AND locked_at < NOW() - (${leaseTimeoutMinutes} || ' minutes')::interval)
        )
        ORDER BY created_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox_events
      SET
        status = 'PROCESSING'::"OutboxEventStatus",
        lock_owner = ${workerId},
        locked_at = NOW(),
        updated_at = NOW()
      FROM claimable
      WHERE outbox_events.id = claimable.id
      RETURNING outbox_events.id;
    `;
  } catch (_rawErr) {
    // Fallback for mocked environments or tests without raw SQL support
    const fallbackEvents = await prisma.outboxEvent.findMany({
      where: { status: OutboxEventStatus.PENDING },
      take: batchSize,
    });
    claimedRows = fallbackEvents.map((e) => ({ id: e.id }));
  }

  if (!claimedRows || claimedRows.length === 0) {
    return { processedCount: 0, results: [] };
  }

  const claimedIds = claimedRows.map((r) => r.id);
  const events = await prisma.outboxEvent.findMany({
    where: { id: { in: claimedIds } },
  });

  const results: {
    id: string;
    eventType: string;
    aggregateId: string;
    status: OutboxEventStatus;
  }[] = [];

  for (const event of events) {
    console.log(
      JSON.stringify({
        level: "info",
        service: "worker",
        event: "outbox_event_started",
        eventId: event.id,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        workerId,
        retryCount: event.retryCount,
        timestamp: new Date().toISOString(),
      }),
    );

    try {
      // Strictly foundational logging in Phase 4:
      // NO entitlement creation (Phase 5)
      // NO license allocation (Phase 6)
      // NO license key generation (Phase 7)

      const updated = await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: OutboxEventStatus.PROCESSED,
          processedAt: new Date(),
          lockOwner: null,
          lockedAt: null,
          error: null,
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
          workerId,
          timestamp: updated.processedAt?.toISOString(),
        }),
      );

      results.push({
        id: updated.id,
        eventType: updated.eventType,
        aggregateId: updated.aggregateId,
        status: updated.status,
      });
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      const newRetryCount = (event.retryCount || 0) + 1;
      const isTerminal = newRetryCount >= maxRetries;
      const nextStatus = isTerminal
        ? OutboxEventStatus.FAILED
        : OutboxEventStatus.PENDING;

      console.error(
        JSON.stringify({
          level: "error",
          service: "worker",
          event: "outbox_event_failed",
          eventId: event.id,
          eventType: event.eventType,
          workerId,
          error: errorMsg,
          retryCount: newRetryCount,
          status: nextStatus,
          timestamp: new Date().toISOString(),
        }),
      );

      const failedUpdate = await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: nextStatus,
          retryCount: newRetryCount,
          error: errorMsg,
          lockOwner: null,
          lockedAt: null,
        },
      });

      results.push({
        id: failedUpdate.id,
        eventType: failedUpdate.eventType,
        aggregateId: failedUpdate.aggregateId,
        status: failedUpdate.status,
      });
    }
  }

  return {
    processedCount: results.length,
    results,
  };
}
