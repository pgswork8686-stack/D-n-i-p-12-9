import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { NotificationsService } from "./notifications.service";
import { QueryNotificationsDto } from "./dto/tickets.dto";
import { NotificationDto } from "@nexus/contracts";

@Controller(["notifications", "v1/notifications"])
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async listMyNotifications(
    @Req() req: any,
    @Query() query: QueryNotificationsDto,
  ): Promise<NotificationDto[]> {
    const userId = req.user.id || req.user.sub;
    return this.notificationsService.listMyNotifications(userId, query);
  }

  @Get("unread-count")
  async getUnreadCount(@Req() req: any): Promise<{ count: number }> {
    const userId = req.user.id || req.user.sub;
    return this.notificationsService.getUnreadCount(userId);
  }

  @Patch(":id/read")
  async markAsRead(
    @Req() req: any,
    @Param("id") id: string,
  ): Promise<NotificationDto> {
    const userId = req.user.id || req.user.sub;
    return this.notificationsService.markAsRead(userId, id);
  }

  @Post("read-all")
  async markAllAsRead(
    @Req() req: any,
  ): Promise<{ success: boolean; updatedCount: number }> {
    const userId = req.user.id || req.user.sub;
    return this.notificationsService.markAllAsRead(userId);
  }
}
