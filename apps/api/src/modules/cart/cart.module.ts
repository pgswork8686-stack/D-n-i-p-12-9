import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { CartService } from "./cart.service";
import { CartController } from "./cart.controller";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
