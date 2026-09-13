import { processOutboxEvents } from "./outbox-processor";
import { prisma, OutboxEventStatus } from "@nexus/database";

jest.mock("@nexus/database", () => {
  return {
    OutboxEventStatus: {
      PENDING: "PENDING",
      PROCESSED: "PROCESSED",
      FAILED: "FAILED",
    },
    prisma: {
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
        status: "PENDING",
        payload: { orderId: "order-123" },
      },
    ];

    (prisma.outboxEvent.findMany as jest.Mock).mockResolvedValue(mockEvents);
    (prisma.outboxEvent.update as jest.Mock).mockResolvedValue({
      id: "evt-1",
      eventType: "ORDER_PAID",
      aggregateType: "Order",
      aggregateId: "order-123",
      status: "PROCESSED",
      processedAt: new Date(),
    });

    const result = await processOutboxEvents();

    expect(prisma.outboxEvent.findMany).toHaveBeenCalledWith({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: 10,
    });

    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: "evt-1" },
      data: {
        status: "PROCESSED",
        processedAt: expect.any(Date),
      },
    });

    expect(result.processedCount).toBe(1);
    expect(result.results[0].status).toBe("PROCESSED");
  });
});
