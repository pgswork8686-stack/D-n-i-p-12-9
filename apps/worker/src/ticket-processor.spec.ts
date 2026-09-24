import {
  processTicketCreatedEvent,
  processTicketRepliedEvent,
  reconcileIdleTickets,
} from "./ticket-processor";
import {
  prisma,
  TicketStatus,
  TicketPriority,
  TicketSenderType,
} from "@nexus/database";

describe("Ticket Worker Processor", () => {
  beforeEach(() => {
    jest.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
      if (typeof callback === "function") {
        return callback(prisma);
      }
      return callback;
    });
    jest.clearAllMocks();
  });

  describe("processTicketCreatedEvent", () => {
    it("handles TICKET_CREATED outbox event payload", async () => {
      const payload = {
        ticketId: "tkt-001",
        ticketNumber: "TK-202609-XYZ1",
        userId: "usr-1",
        subject: "Network connectivity issue",
        category: "HOSTING",
        priority: TicketPriority.HIGH,
      };

      const result = await processTicketCreatedEvent(payload, "worker-test");
      expect(result.handled).toBe(true);
      expect(result.ticketNumber).toBe("TK-202609-XYZ1");
    });
  });

  describe("processTicketRepliedEvent", () => {
    it("handles TICKET_REPLIED outbox event payload", async () => {
      const payload = {
        ticketId: "tkt-001",
        ticketNumber: "TK-202609-XYZ1",
        messageId: "msg-001",
        senderId: "usr-staff-1",
        senderType: TicketSenderType.STAFF,
        isInternalNote: false,
        newStatus: TicketStatus.WAITING_CUSTOMER,
      };

      const result = await processTicketRepliedEvent(payload, "worker-test");
      expect(result.handled).toBe(true);
      expect(result.ticketNumber).toBe("TK-202609-XYZ1");
    });
  });

  describe("reconcileIdleTickets", () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

    const idleTicket = {
      id: "tkt-idle-1",
      ticketNumber: "TK-202609-OLD1",
      userId: "usr-cust-1",
      subject: "Old resolved question",
      status: TicketStatus.WAITING_CUSTOMER,
      updatedAt: eightDaysAgo,
    };

    it("auto-closes idle tickets past 7 days inactivity threshold", async () => {
      jest.spyOn(prisma.ticket, "findMany").mockResolvedValue([idleTicket] as any);
      jest.spyOn(prisma.ticket, "update").mockResolvedValue({} as any);
      jest.spyOn(prisma.ticketMessage, "create").mockResolvedValue({} as any);
      jest.spyOn(prisma.notification, "create").mockResolvedValue({} as any);
      jest.spyOn(prisma.outboxEvent, "create").mockResolvedValue({} as any);

      const result = await reconcileIdleTickets({ autoCloseDays: 7 });

      expect(result.closedCount).toBe(1);
      expect(result.ticketIds).toContain("tkt-idle-1");

      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "tkt-idle-1" },
          data: expect.objectContaining({
            status: TicketStatus.CLOSED,
            closedAt: expect.any(Date),
          }),
        }),
      );

      expect(prisma.ticketMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ticketId: "tkt-idle-1",
            senderType: TicketSenderType.SYSTEM,
          }),
        }),
      );

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "usr-cust-1",
            title: expect.stringContaining("TK-202609-OLD1"),
          }),
        }),
      );
    });

    it("returns 0 closed when no tickets are idle", async () => {
      jest.spyOn(prisma.ticket, "findMany").mockResolvedValue([]);

      const result = await reconcileIdleTickets();
      expect(result.closedCount).toBe(0);
      expect(result.ticketIds).toHaveLength(0);
    });
  });
});
