import { Module } from "@nestjs/common";
import { SubscriptionsController } from "./subscriptions.controller";
import { AdminSubscriptionsController } from "./admin-subscriptions.controller";
import { SubscriptionsService } from "./subscriptions.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [SubscriptionsController, AdminSubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
