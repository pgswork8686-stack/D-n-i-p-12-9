import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { TenantsModule } from "../tenants/tenants.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { AiController } from "./ai.controller";
import { AiRuntimeService } from "./ai-runtime.service";
import { AiContextService } from "./ai-context.service";
import { AiExecutionService } from "./ai-execution.service";

@Module({
  imports: [AuthModule, AuditModule, TenantsModule, AnalyticsModule],
  controllers: [AiController],
  providers: [AiRuntimeService, AiContextService, AiExecutionService],
})
export class AiModule {}
