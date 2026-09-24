import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import {
  prisma,
  TicketPriority,
  TicketStatus,
  TicketSenderType,
  NotificationType,
  isValidTicketTransition,
  determineStatusOnReply,
  filterMessagesForCustomer,
} from "@nexus/database";
import {
  generateTicketNumber,
  sanitizeTicketContent,
  isValidAttachment,
} from "@nexus/utils";
import {
  TicketDto,
  TicketMessageDto,
  TicketAttachmentDto,
} from "@nexus/contracts";
import {
  CreateTicketDto,
  ReplyTicketDto,
  AdminUpdateTicketDto,
  QueryTicketsDto,
} from "./dto/tickets.dto";

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  // ----------------------------------------------------
  // Customer Methods
  // ----------------------------------------------------

  async listMyTickets(
    userId: string,
    query?: QueryTicketsDto,
  ): Promise<{ items: TicketDto[]; total: number }> {
    const page = query?.page && query.page > 0 ? query.page : 1;
    const limit = query?.limit && query.limit > 0 ? query.limit : 20;
    const skip = (page - 1) * limit;

    const where: any = { userId };
    if (query?.status) where.status = query.status;
    if (query?.priority) where.priority = query.priority;
    if (query?.category) where.category = query.category;

    const [total, records] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.ticket.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: "desc" },
        include: {
          messages: {
            where: { isInternalNote: false },
            orderBy: { createdAt: "asc" },
            include: { attachments: true },
          },
        },
      }),
    ]);

    const items = records.map((t) => this.mapTicketToDto(t, false));
    return { items, total };
  }

  async getMyTicket(userId: string, idOrNumber: string): Promise<TicketDto> {
    const ticket = await prisma.ticket.findFirst({
      where: {
        OR: [{ id: idOrNumber }, { ticketNumber: idOrNumber }],
      },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          include: { attachments: true },
        },
      },
    });

    // Anti-enumeration: If ticket does not exist or belongs to another user, return 404
    if (!ticket || ticket.userId !== userId) {
      throw new NotFoundException("Ticket not found");
    }

    return this.mapTicketToDto(ticket, false);
  }

  async createTicket(userId: string, dto: CreateTicketDto): Promise<TicketDto> {
    const cleanSubject = sanitizeTicketContent(dto.subject);
    const cleanBody = sanitizeTicketContent(dto.body);

    if (!cleanSubject) {
      throw new BadRequestException("Subject cannot be empty");
    }
    if (!cleanBody) {
      throw new BadRequestException("Message content cannot be empty");
    }

    if (dto.attachments && dto.attachments.length > 0) {
      for (const att of dto.attachments) {
        const val = isValidAttachment(att.mimeType, att.sizeBytes);
        if (!val.isValid) {
          throw new BadRequestException(val.error);
        }
      }
    }

    const ticketNumber = generateTicketNumber("TK");
    const priority = dto.priority || TicketPriority.NORMAL;

    const created = await prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.create({
        data: {
          ticketNumber,
          userId,
          subject: cleanSubject,
          category: dto.category.trim().toUpperCase(),
          priority,
          status: TicketStatus.OPEN,
          orderId: dto.orderId || null,
          entitlementId: dto.entitlementId || null,
          messages: {
            create: {
              senderId: userId,
              senderType: TicketSenderType.CUSTOMER,
              isInternalNote: false,
              body: cleanBody,
              attachments: dto.attachments && dto.attachments.length > 0
                ? {
                    create: dto.attachments.map((att) => ({
                      fileName: att.fileName,
                      storageKey: att.storageKey,
                      mimeType: att.mimeType,
                      sizeBytes: att.sizeBytes,
                      sha256: att.sha256 || "",
                    })),
                  }
                : undefined,
            },
          },
        },
        include: {
          messages: {
            include: { attachments: true },
          },
        },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: "TICKET_CREATED",
          aggregateType: "Ticket",
          aggregateId: ticket.id,
          payload: {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            userId: ticket.userId,
            subject: ticket.subject,
            category: ticket.category,
            priority: ticket.priority,
          },
          status: "PENDING",
        },
      });

      return ticket;
    });

    this.logger.log(`Created support ticket ${created.ticketNumber} for user ${userId}`);
    return this.mapTicketToDto(created, false);
  }

  async replyTicket(
    userId: string,
    idOrNumber: string,
    dto: ReplyTicketDto,
  ): Promise<TicketMessageDto> {
    const ticket = await prisma.ticket.findFirst({
      where: {
        OR: [{ id: idOrNumber }, { ticketNumber: idOrNumber }],
      },
    });

    // Anti-enumeration: return 404 if not found or unauthorized
    if (!ticket || ticket.userId !== userId) {
      throw new NotFoundException("Ticket not found");
    }

    const cleanBody = sanitizeTicketContent(dto.body);
    if (!cleanBody) {
      throw new BadRequestException("Message content cannot be empty");
    }

    if (dto.attachments && dto.attachments.length > 0) {
      for (const att of dto.attachments) {
        const val = isValidAttachment(att.mimeType, att.sizeBytes);
        if (!val.isValid) {
          throw new BadRequestException(val.error);
        }
      }
    }

    // Customer replies cannot be internal notes
    const isInternalNote = false;
    const nextStatus = determineStatusOnReply(
      ticket.status,
      TicketSenderType.CUSTOMER,
      isInternalNote,
    );

    const message = await prisma.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          status: nextStatus,
          closedAt: nextStatus === TicketStatus.CLOSED ? new Date() : null,
          updatedAt: new Date(),
        },
      });

      const msg = await tx.ticketMessage.create({
        data: {
          ticketId: ticket.id,
          senderId: userId,
          senderType: TicketSenderType.CUSTOMER,
          isInternalNote,
          body: cleanBody,
          attachments: dto.attachments && dto.attachments.length > 0
            ? {
                create: dto.attachments.map((att) => ({
                  fileName: att.fileName,
                  storageKey: att.storageKey,
                  mimeType: att.mimeType,
                  sizeBytes: att.sizeBytes,
                  sha256: att.sha256 || "",
                })),
              }
            : undefined,
        },
        include: { attachments: true },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: "TICKET_REPLIED",
          aggregateType: "Ticket",
          aggregateId: ticket.id,
          payload: {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            messageId: msg.id,
            senderId: userId,
            senderType: TicketSenderType.CUSTOMER,
            isInternalNote,
            newStatus: nextStatus,
          },
          status: "PENDING",
        },
      });

      return msg;
    });

    return this.mapMessageToDto(message);
  }

  // ----------------------------------------------------
  // Admin / Support Staff Methods
  // ----------------------------------------------------

  async adminListTickets(
    query?: QueryTicketsDto,
  ): Promise<{ items: TicketDto[]; total: number }> {
    const page = query?.page && query.page > 0 ? query.page : 1;
    const limit = query?.limit && query.limit > 0 ? query.limit : 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query?.status) where.status = query.status;
    if (query?.priority) where.priority = query.priority;
    if (query?.category) where.category = query.category;
    if (query?.userId) where.userId = query.userId;
    if (query?.assignedAdminId) where.assignedAdminId = query.assignedAdminId;

    const [total, records] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.ticket.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
            include: { attachments: true },
          },
        },
      }),
    ]);

    const items = records.map((t) => this.mapTicketToDto(t, true));
    return { items, total };
  }

  async adminGetTicket(idOrNumber: string): Promise<TicketDto> {
    const ticket = await prisma.ticket.findFirst({
      where: {
        OR: [{ id: idOrNumber }, { ticketNumber: idOrNumber }],
      },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          include: { attachments: true },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException("Ticket not found");
    }

    return this.mapTicketToDto(ticket, true);
  }

  async adminUpdateTicket(
    idOrNumber: string,
    dto: AdminUpdateTicketDto,
  ): Promise<TicketDto> {
    const ticket = await prisma.ticket.findFirst({
      where: {
        OR: [{ id: idOrNumber }, { ticketNumber: idOrNumber }],
      },
    });

    if (!ticket) {
      throw new NotFoundException("Ticket not found");
    }

    if (dto.status && !isValidTicketTransition(ticket.status, dto.status)) {
      throw new BadRequestException(
        `Invalid status transition from ${ticket.status} to ${dto.status}`,
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const isClosing = dto.status === TicketStatus.CLOSED;
      const isReopening =
        ticket.status === TicketStatus.CLOSED &&
        dto.status &&
        dto.status !== TicketStatus.CLOSED;

      const record = await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          ...(dto.assignedAdminId !== undefined && {
            assignedAdminId: dto.assignedAdminId,
          }),
          ...(dto.priority && { priority: dto.priority }),
          ...(dto.status && { status: dto.status }),
          ...(isClosing && { closedAt: new Date() }),
          ...(isReopening && { closedAt: null }),
        },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
            include: { attachments: true },
          },
        },
      });

      if (dto.status && dto.status !== ticket.status) {
        await tx.outboxEvent.create({
          data: {
            eventType: "TICKET_STATUS_CHANGED",
            aggregateType: "Ticket",
            aggregateId: ticket.id,
            payload: {
              ticketId: ticket.id,
              ticketNumber: ticket.ticketNumber,
              oldStatus: ticket.status,
              newStatus: dto.status,
            },
            status: "PENDING",
          },
        });
      }

      return record;
    });

    return this.mapTicketToDto(updated, true);
  }

  async adminReplyTicket(
    staffUserId: string,
    idOrNumber: string,
    dto: ReplyTicketDto,
  ): Promise<TicketMessageDto> {
    const ticket = await prisma.ticket.findFirst({
      where: {
        OR: [{ id: idOrNumber }, { ticketNumber: idOrNumber }],
      },
    });

    if (!ticket) {
      throw new NotFoundException("Ticket not found");
    }

    const cleanBody = sanitizeTicketContent(dto.body);
    if (!cleanBody) {
      throw new BadRequestException("Message content cannot be empty");
    }

    if (dto.attachments && dto.attachments.length > 0) {
      for (const att of dto.attachments) {
        const val = isValidAttachment(att.mimeType, att.sizeBytes);
        if (!val.isValid) {
          throw new BadRequestException(val.error);
        }
      }
    }

    const isInternalNote = Boolean(dto.isInternalNote);
    const nextStatus = determineStatusOnReply(
      ticket.status,
      TicketSenderType.STAFF,
      isInternalNote,
    );

    const message = await prisma.$transaction(async (tx) => {
      // If public reply, update ticket status to WAITING_CUSTOMER
      if (!isInternalNote && nextStatus !== ticket.status) {
        await tx.ticket.update({
          where: { id: ticket.id },
          data: {
            status: nextStatus,
            updatedAt: new Date(),
          },
        });
      }

      const msg = await tx.ticketMessage.create({
        data: {
          ticketId: ticket.id,
          senderId: staffUserId,
          senderType: TicketSenderType.STAFF,
          isInternalNote,
          body: cleanBody,
          attachments: dto.attachments && dto.attachments.length > 0
            ? {
                create: dto.attachments.map((att) => ({
                  fileName: att.fileName,
                  storageKey: att.storageKey,
                  mimeType: att.mimeType,
                  sizeBytes: att.sizeBytes,
                  sha256: att.sha256 || "",
                })),
              }
            : undefined,
        },
        include: { attachments: true },
      });

      // If public staff reply, notify the customer via in-app notification & outbox
      if (!isInternalNote) {
        await tx.notification.create({
          data: {
            userId: ticket.userId,
            type: NotificationType.TICKET_REPLIED,
            title: `Staff replied to ticket #${ticket.ticketNumber}`,
            message: cleanBody.length > 140 ? `${cleanBody.slice(0, 137)}...` : cleanBody,
            actionUrl: `/tickets/${ticket.id}`,
            isRead: false,
          },
        });

        await tx.outboxEvent.create({
          data: {
            eventType: "TICKET_REPLIED",
            aggregateType: "Ticket",
            aggregateId: ticket.id,
            payload: {
              ticketId: ticket.id,
              ticketNumber: ticket.ticketNumber,
              messageId: msg.id,
              senderId: staffUserId,
              senderType: TicketSenderType.STAFF,
              isInternalNote: false,
              newStatus: nextStatus,
            },
            status: "PENDING",
          },
        });
      }

      return msg;
    });

    return this.mapMessageToDto(message);
  }

  // ----------------------------------------------------
  // Helpers & Mappers
  // ----------------------------------------------------

  private mapTicketToDto(ticket: any, isStaffView: boolean): TicketDto {
    const rawMessages = ticket.messages || [];
    const filteredMessages = isStaffView
      ? rawMessages
      : filterMessagesForCustomer(rawMessages);

    return {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      userId: ticket.userId,
      assignedAdminId: ticket.assignedAdminId || null,
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      orderId: ticket.orderId || null,
      entitlementId: ticket.entitlementId || null,
      metadata: ticket.metadata || null,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      closedAt: ticket.closedAt ? ticket.closedAt.toISOString() : null,
      messages: filteredMessages.map((m: any) => this.mapMessageToDto(m)),
    };
  }

  private mapMessageToDto(msg: any): TicketMessageDto {
    return {
      id: msg.id,
      ticketId: msg.ticketId,
      senderId: msg.senderId,
      senderType: msg.senderType,
      isInternalNote: msg.isInternalNote,
      body: msg.body,
      createdAt: msg.createdAt.toISOString(),
      attachments: (msg.attachments || []).map((att: any): TicketAttachmentDto => ({
        id: att.id,
        messageId: att.messageId,
        fileName: att.fileName,
        storageKey: att.storageKey,
        mimeType: att.mimeType,
        sizeBytes: att.sizeBytes,
        sha256: att.sha256 || null,
        createdAt: att.createdAt.toISOString(),
      })),
    };
  }
}
