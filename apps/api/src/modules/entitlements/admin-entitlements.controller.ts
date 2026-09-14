import {
  Controller,
  Get,
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
import { EntitlementsService } from "./entitlements.service";
import {
  AdminEntitlementFilterDto,
  RevokeEntitlementDto,
} from "./dto/entitlements.dto";

@Controller("admin/entitlements")
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminEntitlementsController {
  constructor(private readonly entitlementsService: EntitlementsService) {}

  @Get()
  @RequirePermissions("entitlement.read")
  async listAdminEntitlements(@Query() query: AdminEntitlementFilterDto) {
    return this.entitlementsService.listAdminEntitlements(query);
  }

  @Get(":id")
  @RequirePermissions("entitlement.read")
  async getAdminEntitlement(@Param("id") id: string) {
    return this.entitlementsService.getAdminEntitlement(id);
  }

  @Post(":id/revoke")
  @RequirePermissions("entitlement.manage")
  async revokeEntitlement(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: RevokeEntitlementDto,
  ) {
    return this.entitlementsService.revokeEntitlement(
      id,
      req.user.id,
      body.reason,
    );
  }
}
