import { Module } from "@nestjs/common";
import { TicketsController } from "./tickets.controller";
import { AdminTicketsController } from "./admin-tickets.controller";
import { NotificationsController } from "./notifications.controller";
import { TicketsService } from "./tickets.service";
import { NotificationsService } from "./notifications.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [
    TicketsController,
    AdminTicketsController,
    NotificationsController,
  ],
  providers: [TicketsService, NotificationsService],
  exports: [TicketsService, NotificationsService],
})
export class TicketsModule {}
