import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { prisma, NotificationType } from "@nexus/database";

describe("NotificationsService", () => {
  let service: NotificationsService;

  const mockNotification = {
    id: "notif-001",
    userId: "usr-cust-1",
    type: NotificationType.TICKET_REPLIED,
    title: "Support reply",
    message: "Your ticket has been answered.",
    actionUrl: "/tickets/tkt-001",
    isRead: false,
    readAt: null,
    metadata: null,
    createdAt: new Date("2026-09-24T10:00:00Z"),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationsService],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    jest.clearAllMocks();
  });

  it("lists notifications for user", async () => {
    jest.spyOn(prisma.notification, "findMany").mockResolvedValue([mockNotification] as any);

    const list = await service.listMyNotifications("usr-cust-1", { isRead: false });

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("notif-001");
    expect(list[0].isRead).toBe(false);
  });

  it("returns unread count", async () => {
    jest.spyOn(prisma.notification, "count").mockResolvedValue(5);

    const result = await service.getUnreadCount("usr-cust-1");

    expect(result.count).toBe(5);
  });

  it("marks a notification as read", async () => {
    jest.spyOn(prisma.notification, "findUnique").mockResolvedValue(mockNotification as any);
    jest.spyOn(prisma.notification, "update").mockResolvedValue({
      ...mockNotification,
      isRead: true,
      readAt: new Date(),
    } as any);

    const updated = await service.markAsRead("usr-cust-1", "notif-001");

    expect(updated.isRead).toBe(true);
    expect(updated.readAt).toBeTruthy();
  });

  it("throws 404 when marking a non-existent or wrong user's notification", async () => {
    jest.spyOn(prisma.notification, "findUnique").mockResolvedValue(null);

    await expect(service.markAsRead("usr-cust-1", "notif-999")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("marks all notifications as read", async () => {
    jest.spyOn(prisma.notification, "updateMany").mockResolvedValue({ count: 7 });

    const result = await service.markAllAsRead("usr-cust-1");

    expect(result.success).toBe(true);
    expect(result.updatedCount).toBe(7);
  });
});
