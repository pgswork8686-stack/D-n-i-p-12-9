import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { SubscriptionsService } from "./subscriptions.service";
import {
  AdminCreatePlanDto,
  AdminUpdatePlanDto,
  QuerySubscriptionsDto,
} from "./dto/subscriptions.dto";
import { SubscriptionPlanDto, SubscriptionDto } from "@nexus/contracts";

@Controller(["admin/subscriptions", "v1/admin/subscriptions"])
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminSubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get("plans")
  @RequirePermissions("subscription.read")
  async listPlans(): Promise<SubscriptionPlanDto[]> {
    return this.subscriptionsService.listAdminPlans();
  }

  @Post("plans")
  @RequirePermissions("subscription.manage")
  async createPlan(
    @Body() dto: AdminCreatePlanDto,
  ): Promise<SubscriptionPlanDto> {
    return this.subscriptionsService.createAdminPlan(dto);
  }

  @Patch("plans/:id")
  @RequirePermissions("subscription.manage")
  async updatePlan(
    @Param("id") id: string,
    @Body() dto: AdminUpdatePlanDto,
  ): Promise<SubscriptionPlanDto> {
    return this.subscriptionsService.updateAdminPlan(id, dto);
  }

  @Get()
  @RequirePermissions("subscription.read")
  async listSubscriptions(
    @Query() query: QuerySubscriptionsDto,
  ): Promise<SubscriptionDto[]> {
    return this.subscriptionsService.listAdminSubscriptions(query);
  }

  @Post(":id/cancel")
  @RequirePermissions("subscription.manage")
  async cancelSubscription(
    @Param("id") id: string,
  ): Promise<SubscriptionDto> {
    return this.subscriptionsService.cancelAdminSubscription(id);
  }
}
