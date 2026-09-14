import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { LicensesService } from "./licenses.service";
import { AdminRevokeLicenseDto } from "./dto/licenses.dto";
import { AdminLicenseDto } from "@nexus/contracts";

@Controller("admin/internal-licenses")
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminLicensesController {
  constructor(private readonly licensesService: LicensesService) {}

  @Get()
  @RequirePermissions("license.read")
  async adminListLicenses(): Promise<AdminLicenseDto[]> {
    return this.licensesService.adminListLicenses();
  }

  @Get(":id")
  @RequirePermissions("license.read")
  async adminGetLicense(@Param("id") id: string): Promise<AdminLicenseDto> {
    return this.licensesService.adminGetLicense(id);
  }

  @Post(":id/revoke")
  @RequirePermissions("license.manage")
  async adminRevokeLicense(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: AdminRevokeLicenseDto,
  ): Promise<AdminLicenseDto> {
    return this.licensesService.adminRevokeLicense(id, req.user.id, dto);
  }
}
