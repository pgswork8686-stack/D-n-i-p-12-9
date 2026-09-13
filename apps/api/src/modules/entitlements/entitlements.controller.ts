import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { EntitlementsService } from "./entitlements.service";
import { EntitlementFilterDto } from "./dto/entitlements.dto";

@Controller("entitlements")
@UseGuards(AuthGuard)
export class EntitlementsController {
  constructor(private readonly entitlementsService: EntitlementsService) {}

  @Get()
  async listUserEntitlements(
    @Req() req: any,
    @Query() query: EntitlementFilterDto,
  ) {
    return this.entitlementsService.listUserEntitlements(req.user.id, query);
  }

  @Get(":id")
  async getUserEntitlement(@Req() req: any, @Param("id") id: string) {
    return this.entitlementsService.getUserEntitlement(req.user.id, id);
  }
}
