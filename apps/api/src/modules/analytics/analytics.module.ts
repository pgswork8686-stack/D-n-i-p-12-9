import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { TenantsModule } from "../tenants/tenants.module";
import { AutomationHmacGuard } from "../automation/guards/automation-hmac.guard";
import { AnalyticsController, InternalAnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsIngestService } from "./analytics-ingest.service";

@Module({
  imports: [AuthModule, AuditModule, TenantsModule],
  controllers: [AnalyticsController, InternalAnalyticsController],
  providers: [AnalyticsService, AnalyticsIngestService, AutomationHmacGuard],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
