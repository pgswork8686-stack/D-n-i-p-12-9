import { processOutboxEvents } from "./outbox-processor";
import { prisma, OutboxEventStatus } from "@nexus/database";

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
        update: jest.fn(),
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
    (prisma.outboxEvent.update as jest.Mock).mockResolvedValue({
      id: "evt-1",
      eventType: "ORDER_PAID",
      aggregateType: "Order",
      aggregateId: "order-123",
      status: "PROCESSED",
      processedAt: new Date(),
    });

    const result = await processOutboxEvents({ workerId: "worker-1" });

    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: "evt-1" },
      data: expect.objectContaining({
        status: "PROCESSED",
        processedAt: expect.any(Date),
      }),
    });

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

    // Simulate failure on first update
    (prisma.outboxEvent.update as jest.Mock)
      .mockRejectedValueOnce(new Error("Downstream dispatch failed"))
      .mockResolvedValueOnce({
        id: "evt-retry",
        eventType: "ORDER_PAID",
        aggregateId: "order-retry",
        status: "PENDING",
        retryCount: 2,
      });

    const result = await processOutboxEvents({
      workerId: "worker-1",
      maxRetries: 5,
    });

    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: "evt-retry" },
      data: expect.objectContaining({
        status: "PENDING",
        retryCount: 2,
        error: "Downstream dispatch failed",
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

    (prisma.outboxEvent.update as jest.Mock)
      .mockRejectedValueOnce(new Error("Fatal crash"))
      .mockResolvedValueOnce({
        id: "evt-max",
        eventType: "ORDER_PAID",
        aggregateId: "order-max",
        status: "FAILED",
        retryCount: 5,
      });

    const result = await processOutboxEvents({
      workerId: "worker-1",
      maxRetries: 5,
    });

    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: "evt-max" },
      data: expect.objectContaining({
        status: "FAILED",
        retryCount: 5,
        error: "Fatal crash",
      }),
    });

    expect(result.results[0].status).toBe("FAILED");
  });
});
