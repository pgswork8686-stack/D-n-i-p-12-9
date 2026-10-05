import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { TenantAccessService } from "./tenant-access.service";
import { AdminTenantsController } from "./admin-tenants.controller";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [AdminTenantsController],
  providers: [TenantAccessService],
  exports: [TenantAccessService],
})
export class TenantsModule {}
