import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { LicensesService } from "./licenses.service";
import {
  CustomerLicenseDto,
  RevealLicenseResponse,
  CustomerLicenseActivationDto,
  DeactivateLicenseResponse,
} from "@nexus/contracts";
import { DeactivateLicenseDomainDto } from "./dto/licenses.dto";

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
  @HttpCode(HttpStatus.OK)
  async revealLicense(
    @Req() req: any,
    @Param("id") id: string,
  ): Promise<RevealLicenseResponse> {
    return this.licensesService.customerRevealLicenseKey(id, req.user.id);
  }

  @Get(":id/activations")
  async listCustomerLicenseActivations(
    @Req() req: any,
    @Param("id") id: string,
  ): Promise<CustomerLicenseActivationDto[]> {
    return this.licensesService.listCustomerLicenseActivations(id, req.user.id);
  }

  @Post(":id/deactivate-domain")
  @HttpCode(HttpStatus.OK)
  async deactivateDomain(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: DeactivateLicenseDomainDto,
  ): Promise<DeactivateLicenseResponse> {
    return this.licensesService.customerDeactivateDomain(id, req.user.id, dto.domain);
  }
}
