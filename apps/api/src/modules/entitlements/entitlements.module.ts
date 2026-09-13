import { Module } from "@nestjs/common";
import { EntitlementsService } from "./entitlements.service";
import { EntitlementsController } from "./entitlements.controller";
import { AdminEntitlementsController } from "./admin-entitlements.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuditModule],
  controllers: [EntitlementsController, AdminEntitlementsController],
  providers: [EntitlementsService],
  exports: [EntitlementsService],
})
export class EntitlementsModule {}
