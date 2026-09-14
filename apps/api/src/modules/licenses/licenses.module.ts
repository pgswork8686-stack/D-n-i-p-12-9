import { Module } from "@nestjs/common";
import { LicensesService } from "./licenses.service";
import { LicensesController } from "./licenses.controller";
import { PublicLicensesController } from "./public-licenses.controller";
import { AdminLicensesController } from "./admin-licenses.controller";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [
    LicensesController,
    PublicLicensesController,
    AdminLicensesController,
  ],
  providers: [LicensesService],
  exports: [LicensesService],
})
export class LicensesModule {}
