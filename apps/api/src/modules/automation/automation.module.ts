import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { AutomationService } from "./automation.service";
import { InternalAutomationController } from "./internal-automation.controller";
import { AdminAutomationController } from "./admin-automation.controller";
import { AutomationHmacGuard } from "./guards/automation-hmac.guard";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [AdminAutomationController, InternalAutomationController],
  providers: [AutomationService, AutomationHmacGuard],
  exports: [AutomationService],
})
export class AutomationModule {}
