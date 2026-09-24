import {
  Injectable,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import {
  prisma,
  NotificationType,
} from "@nexus/database";
import { NotificationDto } from "@nexus/contracts";
import { QueryNotificationsDto } from "./dto/tickets.dto";

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  async listMyNotifications(
    userId: string,
    query?: QueryNotificationsDto,
  ): Promise<NotificationDto[]> {
    const limit = query?.limit && query.limit > 0 ? query.limit : 30;
    const where: any = { userId };
    if (query?.isRead !== undefined) {
      where.isRead = query.isRead;
    }

    const records = await prisma.notification.findMany({
      where,
      take: limit,
      orderBy: { createdAt: "desc" },
    });

    return records.map((n) => this.mapNotificationToDto(n));
  }

  async getUnreadCount(userId: string): Promise<{ count: number }> {
    const count = await prisma.notification.count({
      where: {
        userId,
        isRead: false,
      },
    });
    return { count };
  }

  async markAsRead(
    userId: string,
    notificationId: string,
  ): Promise<NotificationDto> {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification || notification.userId !== userId) {
      throw new NotFoundException("Notification not found");
    }

    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return this.mapNotificationToDto(updated);
  }

  async markAllAsRead(
    userId: string,
  ): Promise<{ success: boolean; updatedCount: number }> {
    const result = await prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return {
      success: true,
      updatedCount: result.count,
    };
  }

  async createNotification(data: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    actionUrl?: string;
    metadata?: Record<string, unknown>;
  }): Promise<NotificationDto> {
    const created = await prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        actionUrl: data.actionUrl || null,
        metadata: data.metadata ? (data.metadata as any) : undefined,
        isRead: false,
      },
    });

    return this.mapNotificationToDto(created);
  }

  private mapNotificationToDto(n: any): NotificationDto {
    return {
      id: n.id,
      userId: n.userId,
      type: n.type,
      title: n.title,
      message: n.message,
      actionUrl: n.actionUrl || null,
      isRead: n.isRead,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      metadata: n.metadata || null,
      createdAt: n.createdAt.toISOString(),
    };
  }
}
