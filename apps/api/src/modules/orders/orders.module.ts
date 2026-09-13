import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { OrdersService } from "./orders.service";
import { CheckoutController } from "./checkout.controller";
import { OrdersController } from "./orders.controller";
import { AdminOrdersController } from "./admin-orders.controller";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [CheckoutController, OrdersController, AdminOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
