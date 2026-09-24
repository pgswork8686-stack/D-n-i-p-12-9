import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Req,
  Ip,
  Headers,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { AffiliatesService } from "./affiliates.service";
import {
  RegisterAffiliateDto,
  RecordClickDto,
  RequestPayoutDto,
  QueryReferralsDto,
} from "./dto/affiliates.dto";
import {
  AffiliateAccountDto,
  AffiliateDashboardStatsDto,
  AffiliateClickResponse,
  AffiliateReferralDto,
  AffiliatePayoutDto,
} from "@nexus/contracts";

@Controller(["affiliates", "v1/affiliates"])
export class AffiliatesController {
  constructor(private readonly affiliatesService: AffiliatesService) {}

  @Post("register")
  @UseGuards(AuthGuard)
  async register(
    @Body() dto: RegisterAffiliateDto,
    @Req() req: any,
  ): Promise<AffiliateAccountDto> {
    const userId = req.user.id || req.user.sub;
    return this.affiliatesService.registerAffiliate(userId, dto);
  }

  @Get("me")
  @UseGuards(AuthGuard)
  async getDashboard(@Req() req: any): Promise<AffiliateDashboardStatsDto> {
    const userId = req.user.id || req.user.sub;
    return this.affiliatesService.getMyAffiliateDashboard(userId);
  }

  @Post("click")
  async recordClick(
    @Body() dto: RecordClickDto,
    @Ip() ip: string,
    @Headers("user-agent") userAgent: string,
  ): Promise<AffiliateClickResponse> {
    return this.affiliatesService.recordClick(dto, ip, userAgent);
  }

  @Post("payouts")
  @UseGuards(AuthGuard)
  async requestPayout(
    @Body() dto: RequestPayoutDto,
    @Req() req: any,
  ): Promise<AffiliatePayoutDto> {
    const userId = req.user.id || req.user.sub;
    return this.affiliatesService.requestPayout(userId, dto);
  }

  @Get("payouts")
  @UseGuards(AuthGuard)
  async listPayouts(@Req() req: any): Promise<AffiliatePayoutDto[]> {
    const userId = req.user.id || req.user.sub;
    return this.affiliatesService.listMyPayouts(userId);
  }

  @Get("referrals")
  @UseGuards(AuthGuard)
  async listReferrals(
    @Query() query: QueryReferralsDto,
    @Req() req: any,
  ): Promise<AffiliateReferralDto[]> {
    const userId = req.user.id || req.user.sub;
    return this.affiliatesService.listMyReferrals(userId, query);
  }
}
