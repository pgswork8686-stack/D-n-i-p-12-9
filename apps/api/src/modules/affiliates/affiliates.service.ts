import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import {
  prisma,
  AffiliateStatus,
  ReferralStatus,
  PayoutStatus,
  PayoutMethod,
  isSelfReferral,
  calculateCommissionMinor,
  calculateMatureDate,
  isValidReferralTransition,
  isValidPayoutTransition,
} from "@nexus/database";
import {
  normalizeAffiliateCode,
  hashClientFingerprint,
  DEFAULT_COMMISSION_RATE_BP,
  MIN_COMMISSION_RATE_BP,
  MAX_COMMISSION_RATE_BP,
  MIN_PAYOUT_AMOUNT_USD,
  MIN_PAYOUT_AMOUNT_VND,
} from "@nexus/utils";
import {
  AffiliateAccountDto,
  AffiliateDashboardStatsDto,
  AffiliateClickResponse,
  AffiliateReferralDto,
  AffiliatePayoutDto,
} from "@nexus/contracts";
import {
  RegisterAffiliateDto,
  RecordClickDto,
  RequestPayoutDto,
  AdminUpdateAffiliateStatusDto,
  AdminUpdateCommissionDto,
  AdminProcessPayoutDto,
  QueryAffiliatesDto,
  QueryReferralsDto,
} from "./dto/affiliates.dto";

@Injectable()
export class AffiliatesService {
  private readonly logger = new Logger(AffiliatesService.name);

  // --------------------------------------------------------
  // Customer & Public Endpoints
  // --------------------------------------------------------

  async registerAffiliate(
    userId: string,
    dto: RegisterAffiliateRequestDtoFix,
  ): Promise<AffiliateAccountDto> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const existingUserAccount = await prisma.affiliateAccount.findUnique({
      where: { userId },
    });
    if (existingUserAccount) {
      throw new ConflictException("User already has an affiliate account");
    }

    const normalizedCode = normalizeAffiliateCode(dto.code);

    const existingCode = await prisma.affiliateAccount.findUnique({
      where: { code: normalizedCode },
    });
    if (existingCode) {
      throw new ConflictException(`Affiliate code '${normalizedCode}' is already taken`);
    }

    const created = await prisma.affiliateAccount.create({
      data: {
        userId,
        code: normalizedCode,
        status: AffiliateStatus.ACTIVE,
        commissionRateBp: DEFAULT_COMMISSION_RATE_BP,
        payoutMethod: dto.payoutMethod || PayoutMethod.BANK_TRANSFER,
        payoutDetails: (dto.payoutDetails as any) || null,
        totalEarnedMinor: BigInt(0),
        pendingBalanceMinor: BigInt(0),
        availableBalanceMinor: BigInt(0),
        withdrawnBalanceMinor: BigInt(0),
      },
    });

    return this.mapAccountDto(created);
  }

  async getMyAffiliateDashboard(userId: string): Promise<AffiliateDashboardStatsDto> {
    const account = await prisma.affiliateAccount.findUnique({
      where: { userId },
    });
    if (!account) {
      throw new NotFoundException("Affiliate account not found for this user");
    }

    const totalClicks = await prisma.affiliateClick.count({
      where: { affiliateId: account.id },
    });

    const totalReferrals = await prisma.affiliateReferral.count({
      where: { affiliateId: account.id },
    });

    const pendingReferralsCount = await prisma.affiliateReferral.count({
      where: {
        affiliateId: account.id,
        status: ReferralStatus.PENDING,
      },
    });

    const recentReferrals = await prisma.affiliateReferral.findMany({
      where: { affiliateId: account.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    const conversionRatePercent =
      totalClicks > 0 ? Number(((totalReferrals / totalClicks) * 100).toFixed(2)) : 0;

    return {
      account: this.mapAccountDto(account),
      totalClicks,
      totalReferrals,
      pendingReferralsCount,
      conversionRatePercent,
      recentReferrals: recentReferrals.map((r) => this.mapReferralDto(r)),
    };
  }

  async recordClick(
    dto: RecordClickDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AffiliateClickResponse> {
    let normalizedCode: string;
    try {
      normalizedCode = normalizeAffiliateCode(dto.code);
    } catch {
      return { recorded: false, code: dto.code };
    }

    const account = await prisma.affiliateAccount.findUnique({
      where: { code: normalizedCode },
    });

    if (!account || account.status !== AffiliateStatus.ACTIVE) {
      return { recorded: false, code: normalizedCode };
    }

    const { ipHash, uaHash } = hashClientFingerprint(ipAddress, userAgent);

    await prisma.affiliateClick.create({
      data: {
        affiliateId: account.id,
        ipHash,
        userAgentHash: uaHash,
        referer: dto.referer,
        landingPage: dto.landingPage,
        utmSource: dto.utmSource,
        utmCampaign: dto.utmCampaign,
      },
    });

    return {
      recorded: true,
      code: normalizedCode,
      affiliateId: account.id,
    };
  }

  async requestPayout(
    userId: string,
    dto: RequestPayoutDto,
  ): Promise<AffiliatePayoutDto> {
    const account = await prisma.affiliateAccount.findUnique({
      where: { userId },
    });
    if (!account) {
      throw new NotFoundException("Affiliate account not found");
    }

    if (account.status !== AffiliateStatus.ACTIVE) {
      throw new ForbiddenException("Affiliate account is not active");
    }

    const minAmount = MIN_PAYOUT_AMOUNT_USD; // Default minor threshold
    if (dto.amountMinor < minAmount) {
      throw new BadRequestException(
        `Minimum payout request amount is ${minAmount} minor units`,
      );
    }

    const currentAvailable = Number(account.availableBalanceMinor);
    if (currentAvailable < dto.amountMinor) {
      throw new BadRequestException(
        `Insufficient available balance. Requested: ${dto.amountMinor}, Available: ${currentAvailable}`,
      );
    }

    const payoutMethod = dto.payoutMethod || account.payoutMethod;
    const payoutDetails = dto.payoutDetails || (account.payoutDetails as any) || {};

    const payout = await prisma.$transaction(async (tx) => {
      // Deduct from available balance
      await tx.affiliateAccount.update({
        where: { id: account.id },
        data: {
          availableBalanceMinor: {
            decrement: BigInt(dto.amountMinor),
          },
        },
      });

      return tx.affiliatePayout.create({
        data: {
          affiliateId: account.id,
          amountMinor: dto.amountMinor,
          status: PayoutStatus.REQUESTED,
          payoutMethod,
          payoutDetailsSnapshot: payoutDetails,
        },
      });
    });

    return this.mapPayoutDto(payout);
  }

  async listMyReferrals(
    userId: string,
    query: QueryReferralsDto,
  ): Promise<AffiliateReferralDto[]> {
    const account = await prisma.affiliateAccount.findUnique({
      where: { userId },
    });
    if (!account) {
      throw new NotFoundException("Affiliate account not found");
    }

    const where: any = { affiliateId: account.id };
    if (query.status) where.status = query.status;

    const referrals = await prisma.affiliateReferral.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: query.limit || 20,
      skip: ((query.page || 1) - 1) * (query.limit || 20),
    });

    return referrals.map((r) => this.mapReferralDto(r));
  }

  async listMyPayouts(userId: string): Promise<AffiliatePayoutDto[]> {
    const account = await prisma.affiliateAccount.findUnique({
      where: { userId },
    });
    if (!account) {
      throw new NotFoundException("Affiliate account not found");
    }

    const payouts = await prisma.affiliatePayout.findMany({
      where: { affiliateId: account.id },
      orderBy: { createdAt: "desc" },
    });

    return payouts.map((p) => this.mapPayoutDto(p));
  }

  // --------------------------------------------------------
  // Order Referral Commission Automation (Called from worker)
  // --------------------------------------------------------

  async processOrderReferral(params: {
    orderId: string;
    affiliateId: string;
    customerUserId: string;
    orderAmountMinor: number;
    clickIpHash?: string;
    customerIpHash?: string;
  }): Promise<AffiliateReferralDto | null> {
    const affiliate = await prisma.affiliateAccount.findUnique({
      where: { id: params.affiliateId },
    });
    if (!affiliate || affiliate.status !== AffiliateStatus.ACTIVE) {
      return null;
    }

    // Anti-fraud check
    const fraudCheck = isSelfReferral(
      params.customerUserId,
      affiliate.userId,
      params.clickIpHash,
      params.customerIpHash,
    );

    if (fraudCheck.isFraud) {
      this.logger.warn(
        `Self-referral detected for order ${params.orderId}: ${fraudCheck.reason}`,
      );
      return null;
    }

    // Check if referral already created for this order (idempotency)
    const existing = await prisma.affiliateReferral.findUnique({
      where: { orderId: params.orderId },
    });
    if (existing) {
      return this.mapReferralDto(existing);
    }

    const commissionMinor = calculateCommissionMinor(
      params.orderAmountMinor,
      affiliate.commissionRateBp,
    );
    const matureAt = calculateMatureDate(new Date(), 30);

    const referral = await prisma.$transaction(async (tx) => {
      const ref = await tx.affiliateReferral.create({
        data: {
          affiliateId: affiliate.id,
          orderId: params.orderId,
          customerUserId: params.customerUserId,
          orderAmountMinor: params.orderAmountMinor,
          commissionAmountMinor: commissionMinor,
          status: ReferralStatus.PENDING,
          matureAt,
        },
      });

      await tx.affiliateAccount.update({
        where: { id: affiliate.id },
        data: {
          pendingBalanceMinor: { increment: BigInt(commissionMinor) },
          totalEarnedMinor: { increment: BigInt(commissionMinor) },
        },
      });

      return ref;
    });

    return this.mapReferralDto(referral);
  }

  async clawbackOrderReferral(orderId: string, reason = "ORDER_REFUNDED"): Promise<boolean> {
    const referral = await prisma.affiliateReferral.findUnique({
      where: { orderId },
    });
    if (!referral) return false;

    if (!isValidReferralTransition(referral.status, ReferralStatus.REJECTED)) {
      return false;
    }

    await prisma.$transaction(async (tx) => {
      await tx.affiliateReferral.update({
        where: { id: referral.id },
        data: {
          status: ReferralStatus.REJECTED,
          rejectedAt: new Date(),
          rejectionReason: reason,
        },
      });

      if (referral.status === ReferralStatus.PENDING) {
        await tx.affiliateAccount.update({
          where: { id: referral.affiliateId },
          data: {
            pendingBalanceMinor: { decrement: BigInt(referral.commissionAmountMinor) },
            totalEarnedMinor: { decrement: BigInt(referral.commissionAmountMinor) },
          },
        });
      } else if (referral.status === ReferralStatus.APPROVED) {
        await tx.affiliateAccount.update({
          where: { id: referral.affiliateId },
          data: {
            availableBalanceMinor: { decrement: BigInt(referral.commissionAmountMinor) },
            totalEarnedMinor: { decrement: BigInt(referral.commissionAmountMinor) },
          },
        });
      }
    });

    return true;
  }

  // --------------------------------------------------------
  // Admin Management Endpoints
  // --------------------------------------------------------

  async listAdminAffiliates(query: QueryAffiliatesDto): Promise<AffiliateAccountDto[]> {
    const where: any = {};
    if (query.status) where.status = query.status;

    const accounts = await prisma.affiliateAccount.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: query.limit || 20,
      skip: ((query.page || 1) - 1) * (query.limit || 20),
    });

    return accounts.map((a) => this.mapAccountDto(a));
  }

  async updateAdminAffiliateStatus(
    id: string,
    dto: AdminUpdateAffiliateStatusDto,
  ): Promise<AffiliateAccountDto> {
    const account = await prisma.affiliateAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException("Affiliate account not found");

    const updated = await prisma.affiliateAccount.update({
      where: { id },
      data: { status: dto.status },
    });

    return this.mapAccountDto(updated);
  }

  async updateAdminAffiliateCommission(
    id: string,
    dto: AdminUpdateCommissionDto,
  ): Promise<AffiliateAccountDto> {
    const account = await prisma.affiliateAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException("Affiliate account not found");

    if (
      dto.commissionRateBp < MIN_COMMISSION_RATE_BP ||
      dto.commissionRateBp > MAX_COMMISSION_RATE_BP
    ) {
      throw new BadRequestException(
        `Commission rate must be between ${MIN_COMMISSION_RATE_BP} and ${MAX_COMMISSION_RATE_BP} basis points`,
      );
    }

    const updated = await prisma.affiliateAccount.update({
      where: { id },
      data: { commissionRateBp: dto.commissionRateBp },
    });

    return this.mapAccountDto(updated);
  }

  async listAdminPayouts(): Promise<AffiliatePayoutDto[]> {
    const payouts = await prisma.affiliatePayout.findMany({
      orderBy: { requestedAt: "desc" },
    });
    return payouts.map((p) => this.mapPayoutDto(p));
  }

  async processAdminPayout(
    id: string,
    dto: AdminProcessPayoutDto,
    adminUserId: string,
  ): Promise<AffiliatePayoutDto> {
    const payout = await prisma.affiliatePayout.findUnique({ where: { id } });
    if (!payout) throw new NotFoundException("Payout record not found");

    const targetStatus = dto.status === "COMPLETED" ? PayoutStatus.COMPLETED : PayoutStatus.REJECTED;

    if (!isValidPayoutTransition(payout.status, targetStatus)) {
      throw new BadRequestException(`Cannot transition payout from ${payout.status} to ${targetStatus}`);
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.affiliatePayout.update({
        where: { id },
        data: {
          status: targetStatus,
          referenceCode: dto.referenceCode,
          rejectionReason: dto.rejectionReason,
          processedAt: new Date(),
          processedBy: adminUserId,
        },
      });

      if (targetStatus === PayoutStatus.COMPLETED) {
        await tx.affiliateAccount.update({
          where: { id: payout.affiliateId },
          data: {
            withdrawnBalanceMinor: { increment: BigInt(payout.amountMinor) },
          },
        });
      } else if (targetStatus === PayoutStatus.REJECTED) {
        // Refund back to available balance
        await tx.affiliateAccount.update({
          where: { id: payout.affiliateId },
          data: {
            availableBalanceMinor: { increment: BigInt(payout.amountMinor) },
          },
        });
      }

      return updated;
    });

    return this.mapPayoutDto(result);
  }

  // --------------------------------------------------------
  // Helper Mappers
  // --------------------------------------------------------

  private mapAccountDto(a: any): AffiliateAccountDto {
    return {
      id: a.id,
      userId: a.userId,
      code: a.code,
      status: a.status,
      commissionRateBp: a.commissionRateBp,
      payoutMethod: a.payoutMethod,
      payoutDetails: a.payoutDetails,
      totalEarnedMinor: Number(a.totalEarnedMinor),
      pendingBalanceMinor: Number(a.pendingBalanceMinor),
      availableBalanceMinor: Number(a.availableBalanceMinor),
      withdrawnBalanceMinor: Number(a.withdrawnBalanceMinor),
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    };
  }

  private mapReferralDto(r: any): AffiliateReferralDto {
    return {
      id: r.id,
      affiliateId: r.affiliateId,
      orderId: r.orderId,
      customerUserId: r.customerUserId,
      orderAmountMinor: r.orderAmountMinor,
      commissionAmountMinor: r.commissionAmountMinor,
      status: r.status,
      matureAt: r.matureAt.toISOString(),
      rejectionReason: r.rejectionReason,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private mapPayoutDto(p: any): AffiliatePayoutDto {
    return {
      id: p.id,
      affiliateId: p.affiliateId,
      amountMinor: p.amountMinor,
      currency: p.currency,
      status: p.status,
      payoutMethod: p.payoutMethod,
      referenceCode: p.referenceCode,
      rejectionReason: p.rejectionReason,
      requestedAt: p.requestedAt.toISOString(),
      processedAt: p.processedAt?.toISOString() || null,
      processedBy: p.processedBy,
    };
  }
}

// Helper type alias
type RegisterAffiliateRequestDtoFix = RegisterAffiliateDto;
