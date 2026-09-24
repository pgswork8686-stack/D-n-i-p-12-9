import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { AffiliatesService } from "./affiliates.service";
import {
  AdminUpdateAffiliateStatusDto,
  AdminUpdateCommissionDto,
  AdminProcessPayoutDto,
  QueryAffiliatesDto,
} from "./dto/affiliates.dto";
import {
  AffiliateAccountDto,
  AffiliatePayoutDto,
} from "@nexus/contracts";

@Controller(["admin/affiliates", "v1/admin/affiliates"])
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminAffiliatesController {
  constructor(private readonly affiliatesService: AffiliatesService) {}

  @Get()
  @RequirePermissions("affiliate.read")
  async listAffiliates(
    @Query() query: QueryAffiliatesDto,
  ): Promise<AffiliateAccountDto[]> {
    return this.affiliatesService.listAdminAffiliates(query);
  }

  @Patch(":id/status")
  @RequirePermissions("affiliate.manage")
  async updateStatus(
    @Param("id") id: string,
    @Body() dto: AdminUpdateAffiliateStatusDto,
  ): Promise<AffiliateAccountDto> {
    return this.affiliatesService.updateAdminAffiliateStatus(id, dto);
  }

  @Patch(":id/commission")
  @RequirePermissions("affiliate.manage")
  async updateCommission(
    @Param("id") id: string,
    @Body() dto: AdminUpdateCommissionDto,
  ): Promise<AffiliateAccountDto> {
    return this.affiliatesService.updateAdminAffiliateCommission(id, dto);
  }

  @Get("payouts")
  @RequirePermissions("affiliate.read")
  async listPayouts(): Promise<AffiliatePayoutDto[]> {
    return this.affiliatesService.listAdminPayouts();
  }

  @Post("payouts/:id/process")
  @RequirePermissions("affiliate.manage")
  async processPayout(
    @Param("id") id: string,
    @Body() dto: AdminProcessPayoutDto,
    @Req() req: any,
  ): Promise<AffiliatePayoutDto> {
    const adminUserId = req.user.id || req.user.sub;
    return this.affiliatesService.processAdminPayout(id, dto, adminUserId);
  }
}
