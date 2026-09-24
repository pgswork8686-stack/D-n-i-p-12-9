import { Module } from "@nestjs/common";
import { FinanceController } from "./finance.controller";
import { AdminFinanceController } from "./admin-finance.controller";
import { FinanceService } from "./finance.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [FinanceController, AdminFinanceController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
