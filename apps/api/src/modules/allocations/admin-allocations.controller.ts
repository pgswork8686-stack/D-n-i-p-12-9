import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { AllocationsService } from "./allocations.service";
import {
  AdminActivateAllocationDto,
  AdminRejectAllocationDto,
  AdminRequestDeactivationDto,
  AdminConfirmDeactivatedDto,
  CreateProviderAccountDto,
  UpdateProviderAccountDto,
  AdminAllocationFilterDto,
} from "./dto/allocations.dto";
import {
  LicenseProviderDto,
  ProviderAccountDto,
  LicenseAllocationDto,
  PaginatedResponse,
} from "@nexus/contracts";

@Controller("admin")
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminAllocationsController {
  constructor(private readonly allocationsService: AllocationsService) {}

  // ----------------------------------------------------
  // License Providers
  // ----------------------------------------------------

  @Get("license-providers")
  @RequirePermissions("license.read")
  async listProviders(): Promise<LicenseProviderDto[]> {
    return this.allocationsService.adminListProviders();
  }

  // ----------------------------------------------------
  // Provider Accounts
  // ----------------------------------------------------

  @Get("provider-accounts")
  @RequirePermissions("license.read")
  async listProviderAccounts(
    @Query("providerId") providerId?: string,
  ): Promise<ProviderAccountDto[]> {
    return this.allocationsService.adminListProviderAccounts(providerId);
  }

  @Post("provider-accounts")
  @RequirePermissions("license.manage")
  async createProviderAccount(
    @Req() req: any,
    @Body() dto: CreateProviderAccountDto,
  ): Promise<ProviderAccountDto> {
    return this.allocationsService.adminCreateProviderAccount(dto, req.user.id);
  }

  @Get("provider-accounts/:id")
  @RequirePermissions("license.read")
  async getProviderAccount(
    @Param("id") id: string,
  ): Promise<ProviderAccountDto> {
    return this.allocationsService.adminGetProviderAccount(id);
  }

  @Patch("provider-accounts/:id")
  @RequirePermissions("license.manage")
  async updateProviderAccount(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: UpdateProviderAccountDto,
  ): Promise<ProviderAccountDto> {
    return this.allocationsService.adminUpdateProviderAccount(
      id,
      dto,
      req.user.id,
    );
  }

  // ----------------------------------------------------
  // License Allocations
  // ----------------------------------------------------

  @Get("license-allocations")
  @RequirePermissions("license.read")
  async listAllocations(
    @Query() query: AdminAllocationFilterDto,
  ): Promise<PaginatedResponse<LicenseAllocationDto>> {
    return this.allocationsService.adminListAllocations(query);
  }

  @Get("license-allocations/:id")
  @RequirePermissions("license.read")
  async getAllocation(@Param("id") id: string): Promise<LicenseAllocationDto> {
    return this.allocationsService.adminGetAllocation(id);
  }

  @Post("license-allocations/:id/activate")
  @RequirePermissions("license.manage")
  async activateAllocation(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: AdminActivateAllocationDto,
  ): Promise<LicenseAllocationDto> {
    return this.allocationsService.adminActivateAllocation(
      id,
      dto,
      req.user.id,
    );
  }

  @Post("license-allocations/:id/reject")
  @RequirePermissions("license.manage")
  async rejectAllocation(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: AdminRejectAllocationDto,
  ): Promise<LicenseAllocationDto> {
    return this.allocationsService.adminRejectAllocation(id, dto, req.user.id);
  }

  @Post("license-allocations/:id/request-deactivation")
  @RequirePermissions("license.manage")
  async requestDeactivation(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: AdminRequestDeactivationDto,
  ): Promise<LicenseAllocationDto> {
    return this.allocationsService.adminRequestDeactivation(
      id,
      dto,
      req.user.id,
    );
  }

  @Post("license-allocations/:id/confirm-deactivated")
  @RequirePermissions("license.manage")
  async confirmDeactivated(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: AdminConfirmDeactivatedDto,
  ): Promise<LicenseAllocationDto> {
    return this.allocationsService.adminConfirmDeactivated(
      id,
      dto,
      req.user.id,
    );
  }
}
