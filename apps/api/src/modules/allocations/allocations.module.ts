import { Module } from "@nestjs/common";
import { AllocationsService } from "./allocations.service";
import { AllocationsController } from "./allocations.controller";
import { AdminAllocationsController } from "./admin-allocations.controller";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [AllocationsController, AdminAllocationsController],
  providers: [AllocationsService],
  exports: [AllocationsService],
})
export class AllocationsModule {}
