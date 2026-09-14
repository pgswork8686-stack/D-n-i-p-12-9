import { Controller, Post, Body, HttpCode, HttpStatus } from "@nestjs/common";
import { LicensesService } from "./licenses.service";
import {
  ActivateLicenseDto,
  ValidateLicenseDto,
  DeactivateLicenseDto,
} from "./dto/licenses.dto";
import {
  ActivateLicenseResponse,
  ValidateLicenseResponse,
  DeactivateLicenseResponse,
} from "@nexus/contracts";

@Controller("v1/licenses")
export class PublicLicensesController {
  constructor(private readonly licensesService: LicensesService) {}

  @Post("activate")
  @HttpCode(HttpStatus.OK)
  async activateLicense(
    @Body() dto: ActivateLicenseDto,
  ): Promise<ActivateLicenseResponse> {
    return this.licensesService.activateLicense(dto);
  }

  @Post("validate")
  @HttpCode(HttpStatus.OK)
  async validateLicense(
    @Body() dto: ValidateLicenseDto,
  ): Promise<ValidateLicenseResponse> {
    return this.licensesService.validateLicense(dto);
  }

  @Post("deactivate")
  @HttpCode(HttpStatus.OK)
  async deactivateLicense(
    @Body() dto: DeactivateLicenseDto,
  ): Promise<DeactivateLicenseResponse> {
    return this.licensesService.deactivateLicense(dto);
  }
}
