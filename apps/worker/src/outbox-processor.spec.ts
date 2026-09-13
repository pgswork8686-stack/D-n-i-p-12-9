import { processOutboxEvents } from "./outbox-processor";
import { prisma, OutboxEventStatus } from "@nexus/database";
import { issueEntitlementsForOrder } from "./entitlement-issuer";

jest.mock("./entitlement-issuer", () => ({
  issueEntitlementsForOrder: jest.fn().mockResolvedValue({ orderId: "order-123", issuedCount: 1, entitlements: [] }),
}));

jest.mock("@nexus/database", () => {
  return {
    OutboxEventStatus: {
      PENDING: "PENDING",
      PROCESSING: "PROCESSING",
      PROCESSED: "PROCESSED",
      FAILED: "FAILED",
    },
    prisma: {
      $queryRaw: jest.fn(),
      outboxEvent: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    },
  };
});

describe("OutboxProcessor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("processes pending ORDER_PAID outbox events and updates status to PROCESSED", async () => {
    const mockEvents = [
      {
        id: "evt-1",
        eventType: "ORDER_PAID",
        aggregateType: "Order",
        aggregateId: "order-123",
        status: "PROCESSING",
        retryCount: 0,
        payload: { orderId: "order-123" },
      },
    ];

    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ id: "evt-1" }]);
    (prisma.outboxEvent.findMany as jest.Mock).mockResolvedValue(mockEvents);
    (prisma.outboxEvent.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

    const result = await processOutboxEvents({ workerId: "worker-1" });

    expect(prisma.outboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: "evt-1", status: "PROCESSING", lockOwner: "worker-1" },
      data: expect.objectContaining({
        status: "PROCESSED",
        processedAt: expect.any(Date),
      }),
    });

    expect(issueEntitlementsForOrder).toHaveBeenCalledWith("order-123");
    expect(result.processedCount).toBe(1);
    expect(result.results[0].status).toBe("PROCESSED");
  });

  it("increments retryCount on failure and marks PENDING until maxRetries reached", async () => {
    const mockEvents = [
      {
        id: "evt-retry",
        eventType: "ORDER_PAID",
        aggregateType: "Order",
        aggregateId: "order-retry",
        status: "PROCESSING",
        retryCount: 1,
        payload: { orderId: "order-retry" },
      },
    ];

    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ id: "evt-retry" }]);
    (prisma.outboxEvent.findMany as jest.Mock).mockResolvedValue(mockEvents);

    // Simulate failure on first updateMany
    (prisma.outboxEvent.updateMany as jest.Mock)
      .mockRejectedValueOnce(new Error("Downstream dispatch failed"))
      .mockResolvedValueOnce({ count: 1 });

    const result = await processOutboxEvents({
      workerId: "worker-1",
      maxRetries: 5,
    });

    expect(prisma.outboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: "evt-retry", status: "PROCESSING", lockOwner: "worker-1" },
      data: expect.objectContaining({
        status: "PENDING",
        retryCount: 2,
        error: "Downstream dispatch failed",
        nextAttemptAt: expect.any(Date),
      }),
    });

    expect(result.results[0].status).toBe("PENDING");
  });

  it("marks status as FAILED when maxRetries is reached", async () => {
    const mockEvents = [
      {
        id: "evt-max",
        eventType: "ORDER_PAID",
        aggregateType: "Order",
        aggregateId: "order-max",
        status: "PROCESSING",
        retryCount: 4, // next will be 5 == maxRetries
        payload: { orderId: "order-max" },
      },
    ];

    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ id: "evt-max" }]);
    (prisma.outboxEvent.findMany as jest.Mock).mockResolvedValue(mockEvents);

    (prisma.outboxEvent.updateMany as jest.Mock)
      .mockRejectedValueOnce(new Error("Fatal crash"))
      .mockResolvedValueOnce({ count: 1 });

    const result = await processOutboxEvents({
      workerId: "worker-1",
      maxRetries: 5,
    });

    expect(prisma.outboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: "evt-max", status: "PROCESSING", lockOwner: "worker-1" },
      data: expect.objectContaining({
        status: "FAILED",
        retryCount: 5,
        error: "Fatal crash",
      }),
    });

    expect(result.results[0].status).toBe("FAILED");
  });

  it("skips finalization if worker lease was lost (updateMany count === 0)", async () => {
    const mockEvents = [
      {
        id: "evt-stale",
        eventType: "ORDER_PAID",
        aggregateType: "Order",
        aggregateId: "order-stale",
        status: "PROCESSING",
        retryCount: 0,
        payload: { orderId: "order-stale" },
      },
    ];

    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ id: "evt-stale" }]);
    (prisma.outboxEvent.findMany as jest.Mock).mockResolvedValue(mockEvents);
    // Lease expired and was reclaimed by another worker -> count is 0
    (prisma.outboxEvent.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

    const result = await processOutboxEvents({ workerId: "worker-stale" });

    expect(result.processedCount).toBe(0);
    expect(result.results.length).toBe(0);
  });
});
