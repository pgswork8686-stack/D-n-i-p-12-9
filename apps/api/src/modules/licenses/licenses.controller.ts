import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { LicensesService } from "./licenses.service";
import { CustomerLicenseDto, RevealLicenseResponse } from "@nexus/contracts";

@Controller("licenses")
@UseGuards(AuthGuard)
export class LicensesController {
  constructor(private readonly licensesService: LicensesService) {}

  @Get()
  async listCustomerLicenses(@Req() req: any): Promise<CustomerLicenseDto[]> {
    return this.licensesService.listCustomerLicenses(req.user.id);
  }

  @Get(":id")
  async getCustomerLicense(
    @Req() req: any,
    @Param("id") id: string,
  ): Promise<CustomerLicenseDto> {
    return this.licensesService.getCustomerLicense(id, req.user.id);
  }

  @Post(":id/reveal")
  async revealLicense(
    @Req() req: any,
    @Param("id") id: string,
  ): Promise<RevealLicenseResponse> {
    return this.licensesService.customerRevealLicenseKey(id, req.user.id);
  }
}
