import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  prisma,
  SubscriptionStatus,
  EntitlementStatus,
  ProductType,
  FulfillmentType,
  calculateNextPeriodEnd,
  isValidSubscriptionTransition,
} from "@nexus/database";
import {
  SubscriptionPlanDto,
  SubscriptionDto,
  SessionResponseDto,
  CheckMembershipQuotaResponse,
} from "@nexus/contracts";
import {
  CreateSubscriptionSessionDto,
  CreatePortalSessionDto,
  AdminCreatePlanDto,
  AdminUpdatePlanDto,
  QuerySubscriptionsDto,
} from "./dto/subscriptions.dto";

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(private readonly config: ConfigService) {}

  // --------------------------------------------------------
  // Public & Customer Endpoints
  // --------------------------------------------------------

  async listPublicPlans(): Promise<SubscriptionPlanDto[]> {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: [{ priceMinor: "asc" }],
    });
    return plans.map((p) => this.mapPlanDto(p));
  }

  async getMySubscription(userId: string): Promise<SubscriptionDto> {
    const sub = await prisma.subscription.findFirst({
      where: {
        userId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE, SubscriptionStatus.TRIALING] },
      },
      include: {
        plan: true,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!sub) {
      throw new NotFoundException("No active subscription found for this user");
    }

    const quotaInfo = await this.getDailyQuotaUsage(userId, sub.plan.dailyDownloadQuota);

    return {
      id: sub.id,
      userId: sub.userId,
      planId: sub.planId,
      status: sub.status,
      stripeCustomerId: sub.stripeCustomerId,
      stripeSubscriptionId: sub.stripeSubscriptionId,
      currentPeriodStart: sub.currentPeriodStart.toISOString(),
      currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      canceledAt: sub.canceledAt?.toISOString() || null,
      trialEndsAt: sub.trialEndsAt?.toISOString() || null,
      endedAt: sub.endedAt?.toISOString() || null,
      dailyDownloadQuota: sub.plan.dailyDownloadQuota,
      downloadsUsedToday: quotaInfo.usedToday,
      quotaRemainingToday: quotaInfo.remainingToday,
      plan: this.mapPlanDto(sub.plan),
      createdAt: sub.createdAt.toISOString(),
      updatedAt: sub.updatedAt.toISOString(),
    };
  }

  async createSubscriptionCheckoutSession(
    userId: string,
    dto: CreateSubscriptionSessionDto,
  ): Promise<SessionResponseDto> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id: dto.planId },
    });
    if (!plan || !plan.isActive) {
      throw new NotFoundException("Subscription plan not found or inactive");
    }

    // Check if user already has an active subscription
    const existing = await prisma.subscription.findFirst({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
      },
    });
    if (existing) {
      throw new ConflictException(
        "User already has an active subscription. Manage existing subscription via portal.",
      );
    }

    const isMock =
      this.config.get("STRIPE_MOCK_CLIENT") === "true" ||
      this.config.get("NODE_ENV") !== "production";

    if (isMock) {
      // Mock session creation: Creates ACTIVE subscription and linked Entitlement directly for dev/test
      const now = new Date();
      const nextEnd = calculateNextPeriodEnd(now, plan.interval);
      const mockSubId = `sub_mock_${Date.now()}`;

      const createdSub = await prisma.$transaction(async (tx) => {
        const sub = await tx.subscription.create({
          data: {
            userId,
            planId: plan.id,
            status: SubscriptionStatus.ACTIVE,
            stripeCustomerId: `cus_mock_${userId.slice(0, 8)}`,
            stripeSubscriptionId: mockSubId,
            currentPeriodStart: now,
            currentPeriodEnd: nextEnd,
            cancelAtPeriodEnd: false,
          },
        });

        // Create or find dummy catalog product for membership entitlement
        let membershipProduct = await tx.product.findFirst({
          where: { productType: ProductType.MEMBERSHIP },
        });

        if (!membershipProduct) {
          membershipProduct = await tx.product.create({
            data: {
              name: `Membership: ${plan.name}`,
              slug: `membership-${plan.slug}`,
              productType: ProductType.MEMBERSHIP,
              fulfillmentType: FulfillmentType.MEMBERSHIP_ACCESS,
              status: "ACTIVE",
            },
          });
        }

        let variant = await tx.productVariant.findFirst({
          where: { productId: membershipProduct.id },
        });

        if (!variant) {
          variant = await tx.productVariant.create({
            data: {
              productId: membershipProduct.id,
              name: "Standard",
              sku: `MBR-${plan.slug.toUpperCase()}`,
              status: "ACTIVE",
            },
          });
        }

        // Create order item and order record placeholder if needed
        const order = await tx.order.create({
          data: {
            orderNumber: `ORD-SUB-${Date.now()}`,
            userId,
            status: "PAID",
            currency: plan.currency,
            subtotalAmount: plan.priceMinor,
            discountAmount: 0,
            totalAmount: plan.priceMinor,
          },
        });

        const orderItem = await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: membershipProduct.id,
            variantId: variant.id,
            productName: `Membership: ${plan.name}`,
            variantName: "Standard",
            sku: `MBR-${plan.slug.toUpperCase()}`,
            quantity: 1,
            unitAmount: plan.priceMinor,
            lineTotalAmount: plan.priceMinor,
            currency: plan.currency,
            productType: ProductType.MEMBERSHIP,
            fulfillmentType: FulfillmentType.MEMBERSHIP_ACCESS,
          },
        });

        await tx.entitlement.create({
          data: {
            userId,
            orderId: order.id,
            orderItemId: orderItem.id,
            productId: membershipProduct.id,
            variantId: variant.id,
            productType: ProductType.MEMBERSHIP,
            fulfillmentType: FulfillmentType.MEMBERSHIP_ACCESS,
            status: EntitlementStatus.ACTIVE,
            quantity: 1,
            expiresAt: nextEnd,
            subscriptionId: sub.id,
          },
        });

        return sub;
      });

      return {
        sessionUrl: `${dto.successUrl}?session_id=${mockSubId}`,
        sessionId: mockSubId,
      };
    }

    // In live mode with Stripe API:
    // Generate Stripe checkout session with mode: 'subscription'
    throw new BadRequestException("Live Stripe Subscription session requires configured Stripe live key");
  }

  async createCustomerPortalSession(
    userId: string,
    dto: CreatePortalSessionDto,
  ): Promise<SessionResponseDto> {
    const sub = await prisma.subscription.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    if (!sub) {
      throw new NotFoundException("No subscription found for this user");
    }

    // Dev/Mock fallback
    const isMock =
      this.config.get("STRIPE_MOCK_CLIENT") === "true" ||
      this.config.get("NODE_ENV") !== "production";

    if (isMock) {
      return {
        sessionUrl: `${dto.returnUrl}?mock_portal=1`,
      };
    }

    throw new BadRequestException("Live Stripe Billing Portal requires livemode credentials");
  }

  // --------------------------------------------------------
  // Membership Quota Checking & Enforcement
  // --------------------------------------------------------

  async checkMembershipQuota(
    userId: string,
    entitlementId: string,
  ): Promise<CheckMembershipQuotaResponse> {
    const entitlement = await prisma.entitlement.findUnique({
      where: { id: entitlementId },
      include: {
        subscription: {
          include: { plan: true },
        },
      },
    });

    if (!entitlement || entitlement.userId !== userId) {
      throw new NotFoundException("Entitlement not found");
    }

    if (entitlement.status !== EntitlementStatus.ACTIVE) {
      throw new ForbiddenException("Entitlement is not active");
    }

    if (entitlement.fulfillmentType !== FulfillmentType.MEMBERSHIP_ACCESS) {
      return {
        allowed: true,
        dailyLimit: 9999,
        usedToday: 0,
        remainingToday: 9999,
        resetsAt: new Date(Date.now() + 86400000).toISOString(),
      };
    }

    const sub = entitlement.subscription;
    if (!sub || sub.status !== SubscriptionStatus.ACTIVE) {
      throw new ForbiddenException("Membership subscription is inactive or expired");
    }

    const dailyLimit = sub.plan.dailyDownloadQuota;
    const usage = await this.getDailyQuotaUsage(userId, dailyLimit);

    return {
      allowed: usage.remainingToday > 0,
      dailyLimit,
      usedToday: usage.usedToday,
      remainingToday: usage.remainingToday,
      resetsAt: usage.resetsAt,
    };
  }

  private async getDailyQuotaUsage(
    userId: string,
    dailyLimit: number,
  ): Promise<{ usedToday: number; remainingToday: number; resetsAt: string }> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const usedToday = await prisma.downloadEvent.count({
      where: {
        userId,
        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });

    const remainingToday = Math.max(0, dailyLimit - usedToday);
    return {
      usedToday,
      remainingToday,
      resetsAt: endOfDay.toISOString(),
    };
  }

  // --------------------------------------------------------
  // Admin Management Endpoints
  // --------------------------------------------------------

  async listAdminPlans(): Promise<SubscriptionPlanDto[]> {
    const plans = await prisma.subscriptionPlan.findMany({
      orderBy: [{ createdAt: "desc" }],
    });
    return plans.map((p) => this.mapPlanDto(p));
  }

  async createAdminPlan(dto: AdminCreatePlanDto): Promise<SubscriptionPlanDto> {
    const existing = await prisma.subscriptionPlan.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) {
      throw new ConflictException(`Subscription plan slug '${dto.slug}' already exists`);
    }

    const plan = await prisma.subscriptionPlan.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        tier: dto.tier,
        interval: dto.interval,
        priceMinor: dto.priceMinor,
        currency: dto.currency,
        dailyDownloadQuota: dto.dailyDownloadQuota,
        maxActivationsPerProduct: dto.maxActivationsPerProduct ?? 1,
        features: dto.features ?? [],
        isActive: dto.isActive ?? true,
        stripePriceId: dto.stripePriceId,
      },
    });

    return this.mapPlanDto(plan);
  }

  async updateAdminPlan(
    id: string,
    dto: AdminUpdatePlanDto,
  ): Promise<SubscriptionPlanDto> {
    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id },
    });
    if (!plan) {
      throw new NotFoundException("Subscription plan not found");
    }

    const updated = await prisma.subscriptionPlan.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        dailyDownloadQuota: dto.dailyDownloadQuota,
        maxActivationsPerProduct: dto.maxActivationsPerProduct,
        features: dto.features,
        isActive: dto.isActive,
        stripePriceId: dto.stripePriceId,
      },
    });

    return this.mapPlanDto(updated);
  }

  async listAdminSubscriptions(query: QuerySubscriptionsDto): Promise<SubscriptionDto[]> {
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.userId) where.userId = query.userId;

    const subs = await prisma.subscription.findMany({
      where,
      include: { plan: true },
      orderBy: { createdAt: "desc" },
      take: query.limit,
      skip: ((query.page || 1) - 1) * (query.limit || 20),
    });

    return subs.map((sub) => ({
      id: sub.id,
      userId: sub.userId,
      planId: sub.planId,
      status: sub.status,
      stripeCustomerId: sub.stripeCustomerId,
      stripeSubscriptionId: sub.stripeSubscriptionId,
      currentPeriodStart: sub.currentPeriodStart.toISOString(),
      currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      canceledAt: sub.canceledAt?.toISOString() || null,
      trialEndsAt: sub.trialEndsAt?.toISOString() || null,
      endedAt: sub.endedAt?.toISOString() || null,
      dailyDownloadQuota: sub.plan.dailyDownloadQuota,
      downloadsUsedToday: 0,
      quotaRemainingToday: sub.plan.dailyDownloadQuota,
      plan: this.mapPlanDto(sub.plan),
      createdAt: sub.createdAt.toISOString(),
      updatedAt: sub.updatedAt.toISOString(),
    }));
  }

  async cancelAdminSubscription(id: string): Promise<SubscriptionDto> {
    const sub = await prisma.subscription.findUnique({
      where: { id },
      include: { plan: true },
    });
    if (!sub) {
      throw new NotFoundException("Subscription not found");
    }

    if (!isValidSubscriptionTransition(sub.status, SubscriptionStatus.CANCELED)) {
      throw new BadRequestException(`Cannot cancel subscription in ${sub.status} state`);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const canceled = await tx.subscription.update({
        where: { id },
        data: {
          status: SubscriptionStatus.CANCELED,
          canceledAt: new Date(),
          endedAt: new Date(),
        },
        include: { plan: true },
      });

      // Revoke any linked active entitlements
      await tx.entitlement.updateMany({
        where: {
          subscriptionId: id,
          status: EntitlementStatus.ACTIVE,
        },
        data: {
          status: EntitlementStatus.REVOKED,
          revokedAt: new Date(),
        },
      });

      return canceled;
    });

    return {
      id: updated.id,
      userId: updated.userId,
      planId: updated.planId,
      status: updated.status,
      stripeCustomerId: updated.stripeCustomerId,
      stripeSubscriptionId: updated.stripeSubscriptionId,
      currentPeriodStart: updated.currentPeriodStart.toISOString(),
      currentPeriodEnd: updated.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: updated.cancelAtPeriodEnd,
      canceledAt: updated.canceledAt?.toISOString() || null,
      trialEndsAt: updated.trialEndsAt?.toISOString() || null,
      endedAt: updated.endedAt?.toISOString() || null,
      dailyDownloadQuota: updated.plan.dailyDownloadQuota,
      downloadsUsedToday: 0,
      quotaRemainingToday: 0,
      plan: this.mapPlanDto(updated.plan),
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  private mapPlanDto(plan: any): SubscriptionPlanDto {
    return {
      id: plan.id,
      name: plan.name,
      slug: plan.slug,
      description: plan.description,
      tier: plan.tier,
      interval: plan.interval,
      priceMinor: plan.priceMinor,
      currency: plan.currency,
      dailyDownloadQuota: plan.dailyDownloadQuota,
      maxActivationsPerProduct: plan.maxActivationsPerProduct,
      features: (plan.features as string[]) || [],
      isActive: plan.isActive,
      stripePriceId: plan.stripePriceId,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    };
  }
}
