import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { TicketsService } from "./tickets.service";
import {
  prisma,
  TicketPriority,
  TicketStatus,
  TicketSenderType,
} from "@nexus/database";

describe("TicketsService", () => {
  let service: TicketsService;

  const mockCustomerTicket = {
    id: "tkt-001",
    ticketNumber: "TK-202609-A1B2",
    userId: "usr-cust-1",
    assignedAdminId: null,
    subject: "Cannot access cPanel account",
    category: "HOSTING",
    priority: TicketPriority.HIGH,
    status: TicketStatus.OPEN,
    orderId: "ord-101",
    entitlementId: null,
    metadata: null,
    closedAt: null,
    createdAt: new Date("2026-09-24T10:00:00Z"),
    updatedAt: new Date("2026-09-24T10:00:00Z"),
    messages: [
      {
        id: "msg-001",
        ticketId: "tkt-001",
        senderId: "usr-cust-1",
        senderType: TicketSenderType.CUSTOMER,
        isInternalNote: false,
        body: "I am having trouble logging into my control panel.",
        createdAt: new Date("2026-09-24T10:00:00Z"),
        attachments: [],
      },
      {
        id: "msg-002",
        ticketId: "tkt-001",
        senderId: "usr-admin-1",
        senderType: TicketSenderType.STAFF,
        isInternalNote: true,
        body: "Internal note: Checked server logs, node was rebooted.",
        createdAt: new Date("2026-09-24T10:05:00Z"),
        attachments: [],
      },
      {
        id: "msg-003",
        ticketId: "tkt-001",
        senderId: "usr-admin-1",
        senderType: TicketSenderType.STAFF,
        isInternalNote: false,
        body: "Please try logging in again now.",
        createdAt: new Date("2026-09-24T10:10:00Z"),
        attachments: [],
      },
    ],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TicketsService],
    }).compile();

    service = module.get<TicketsService>(TicketsService);

    jest.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
      if (typeof callback === "function") {
        return callback(prisma);
      }
      return callback;
    });

    jest.clearAllMocks();
  });

  describe("Customer Ticket Management", () => {
    it("creates a ticket, sanitizes body, and emits outbox event", async () => {
      jest.spyOn(prisma.ticket, "create").mockResolvedValue({
        ...mockCustomerTicket,
        messages: [mockCustomerTicket.messages[0]],
      } as any);
      jest.spyOn(prisma.outboxEvent, "create").mockResolvedValue({} as any);

      const result = await service.createTicket("usr-cust-1", {
        subject: "   Need help with billing   ",
        body: "Please <script>alert('xss')</script>check my invoice.",
        category: "billing",
        priority: TicketPriority.HIGH,
      });

      expect(result.id).toBe("tkt-001");
      expect(prisma.ticket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "usr-cust-1",
            subject: "Need help with billing",
            category: "BILLING",
            priority: TicketPriority.HIGH,
          }),
        }),
      );
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "TICKET_CREATED",
            aggregateType: "Ticket",
          }),
        }),
      );
    });

    it("rejects ticket creation if body is empty or only malicious script", async () => {
      await expect(
        service.createTicket("usr-cust-1", {
          subject: "Valid subject",
          body: "<script>dangerousCode()</script>",
          category: "GENERAL",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects ticket creation if attachment format is disallowed", async () => {
      await expect(
        service.createTicket("usr-cust-1", {
          subject: "Attachment test",
          body: "Here is an executable file",
          category: "TECH",
          attachments: [
            {
              fileName: "malware.exe",
              storageKey: "uploads/malware.exe",
              mimeType: "application/x-msdownload",
              sizeBytes: 1024,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("filters internal notes when customer views own ticket", async () => {
      jest.spyOn(prisma.ticket, "findFirst").mockResolvedValue(mockCustomerTicket as any);

      const result = await service.getMyTicket("usr-cust-1", "tkt-001");

      expect(result.id).toBe("tkt-001");
      expect(result.messages).toHaveLength(2); // Internal note msg-002 is stripped
      expect(result.messages?.find((m) => m.isInternalNote)).toBeUndefined();
    });

    it("enforces anti-enumeration: returns 404 if ticket belongs to another customer", async () => {
      jest.spyOn(prisma.ticket, "findFirst").mockResolvedValue(mockCustomerTicket as any);

      await expect(
        service.getMyTicket("usr-other-attacker", "tkt-001"),
      ).rejects.toThrow(NotFoundException);
    });

    it("allows customer to reply and transitions status to WAITING_STAFF", async () => {
      jest.spyOn(prisma.ticket, "findFirst").mockResolvedValue({
        ...mockCustomerTicket,
        status: TicketStatus.WAITING_CUSTOMER,
      } as any);
      jest.spyOn(prisma.ticket, "update").mockResolvedValue({} as any);
      jest.spyOn(prisma.ticketMessage, "create").mockResolvedValue({
        id: "msg-004",
        ticketId: "tkt-001",
        senderId: "usr-cust-1",
        senderType: TicketSenderType.CUSTOMER,
        isInternalNote: false,
        body: "I am still seeing the error.",
        createdAt: new Date(),
        attachments: [],
      } as any);
      jest.spyOn(prisma.outboxEvent, "create").mockResolvedValue({} as any);

      const reply = await service.replyTicket("usr-cust-1", "tkt-001", {
        body: "I am still seeing the error.",
      });

      expect(reply.id).toBe("msg-004");
      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: TicketStatus.WAITING_STAFF,
          }),
        }),
      );
    });
  });

  describe("Admin / Staff Helpdesk Operations", () => {
    it("allows staff to view all messages including internal notes", async () => {
      jest.spyOn(prisma.ticket, "findFirst").mockResolvedValue(mockCustomerTicket as any);

      const result = await service.adminGetTicket("tkt-001");

      expect(result.messages).toHaveLength(3);
      expect(result.messages?.some((m) => m.isInternalNote)).toBe(true);
    });

    it("staff internal note does not change ticket status or create customer notification", async () => {
      jest.spyOn(prisma.ticket, "findFirst").mockResolvedValue({
        ...mockCustomerTicket,
        status: TicketStatus.OPEN,
      } as any);
      jest.spyOn(prisma.ticketMessage, "create").mockResolvedValue({
        id: "msg-005",
        ticketId: "tkt-001",
        senderId: "usr-staff-1",
        senderType: TicketSenderType.STAFF,
        isInternalNote: true,
        body: "Escalating to tier 2 network engineering.",
        createdAt: new Date(),
        attachments: [],
      } as any);
      jest.spyOn(prisma.ticket, "update");
      jest.spyOn(prisma.notification, "create");

      const note = await service.adminReplyTicket("usr-staff-1", "tkt-001", {
        body: "Escalating to tier 2 network engineering.",
        isInternalNote: true,
      });

      expect(note.isInternalNote).toBe(true);
      expect(prisma.ticket.update).not.toHaveBeenCalled();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it("staff public reply changes status to WAITING_CUSTOMER and creates notification", async () => {
      jest.spyOn(prisma.ticket, "findFirst").mockResolvedValue({
        ...mockCustomerTicket,
        status: TicketStatus.WAITING_STAFF,
      } as any);
      jest.spyOn(prisma.ticket, "update").mockResolvedValue({} as any);
      jest.spyOn(prisma.ticketMessage, "create").mockResolvedValue({
        id: "msg-006",
        ticketId: "tkt-001",
        senderId: "usr-staff-1",
        senderType: TicketSenderType.STAFF,
        isInternalNote: false,
        body: "Your server IP has been unblocked. Please verify.",
        createdAt: new Date(),
        attachments: [],
      } as any);
      jest.spyOn(prisma.notification, "create").mockResolvedValue({} as any);
      jest.spyOn(prisma.outboxEvent, "create").mockResolvedValue({} as any);

      const reply = await service.adminReplyTicket("usr-staff-1", "tkt-001", {
        body: "Your server IP has been unblocked. Please verify.",
        isInternalNote: false,
      });

      expect(reply.isInternalNote).toBe(false);
      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: TicketStatus.WAITING_CUSTOMER,
          }),
        }),
      );
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "usr-cust-1",
            title: expect.stringContaining("TK-202609-A1B2"),
          }),
        }),
      );
    });

    it("admin updates ticket status and sets closedAt when resolving/closing", async () => {
      jest.spyOn(prisma.ticket, "findFirst").mockResolvedValue(mockCustomerTicket as any);
      jest.spyOn(prisma.ticket, "update").mockResolvedValue({
        ...mockCustomerTicket,
        status: TicketStatus.CLOSED,
        closedAt: new Date(),
      } as any);
      jest.spyOn(prisma.outboxEvent, "create").mockResolvedValue({} as any);

      const updated = await service.adminUpdateTicket("tkt-001", {
        status: TicketStatus.CLOSED,
      });

      expect(updated.status).toBe(TicketStatus.CLOSED);
      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: TicketStatus.CLOSED,
            closedAt: expect.any(Date),
          }),
        }),
      );
    });
  });
});
