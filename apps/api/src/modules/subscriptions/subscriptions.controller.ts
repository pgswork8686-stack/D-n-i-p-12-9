import { RequireFeature } from "../../common/feature-flags";
import {
  HttpCode,
  HttpStatus,
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { SubscriptionsService } from "./subscriptions.service";
import {
  CreateSubscriptionSessionDto,
  CreatePortalSessionDto,
} from "./dto/subscriptions.dto";
import {
  SubscriptionPlanDto,
  SubscriptionDto,
  SessionResponseDto,
  CheckMembershipQuotaResponse,
} from "@nexus/contracts";

@RequireFeature("membership")
@Controller(["subscriptions", "v1/subscriptions"])
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get("plans")
  async listPublicPlans(): Promise<SubscriptionPlanDto[]> {
    return this.subscriptionsService.listPublicPlans();
  }

  @Get("me")
  @UseGuards(AuthGuard)
  async getMySubscription(@Req() req: any): Promise<SubscriptionDto> {
    const userId = req.user.id || req.user.sub;
    return this.subscriptionsService.getMySubscription(userId);
  }

  @Post("checkout-session")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  async createCheckoutSession(
    @Body() dto: CreateSubscriptionSessionDto,
    @Req() req: any,
  ): Promise<SessionResponseDto> {
    const userId = req.user.id || req.user.sub;
    return this.subscriptionsService.createSubscriptionCheckoutSession(userId, dto);
  }

  @Post("customer-portal")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  async createPortalSession(
    @Body() dto: CreatePortalSessionDto,
    @Req() req: any,
  ): Promise<SessionResponseDto> {
    const userId = req.user.id || req.user.sub;
    return this.subscriptionsService.createCustomerPortalSession(userId, dto);
  }

  @Get("quota/:entitlementId")
  @UseGuards(AuthGuard)
  async checkQuota(
    @Param("entitlementId") entitlementId: string,
    @Req() req: any,
  ): Promise<CheckMembershipQuotaResponse> {
    const userId = req.user.id || req.user.sub;
    return this.subscriptionsService.checkMembershipQuota(userId, entitlementId);
  }
}
