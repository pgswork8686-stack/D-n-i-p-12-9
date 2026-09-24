import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { SubscriptionsService } from "./subscriptions.service";
import {
  prisma,
  SubscriptionStatus,
  EntitlementStatus,
  ProductType,
  FulfillmentType,
  SubscriptionTier,
  BillingInterval,
  Currency,
} from "@nexus/database";

describe("SubscriptionsService", () => {
  let service: SubscriptionsService;
  let configService: ConfigService;

  const mockPlan = {
    id: "plan-uuid-1",
    name: "Club Member",
    slug: "club-member",
    description: "Access to all themes",
    tier: SubscriptionTier.PRO,
    interval: BillingInterval.MONTHLY,
    priceMinor: 2900,
    currency: Currency.USD,
    dailyDownloadQuota: 10,
    maxActivationsPerProduct: 1,
    stripePriceId: "price_123",
    features: ["All Themes", "Daily Updates"],
    isActive: true,
    createdAt: new Date("2026-09-01"),
    updatedAt: new Date("2026-09-01"),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === "STRIPE_MOCK_CLIENT") return "true";
              if (key === "NODE_ENV") return "test";
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
    configService = module.get<ConfigService>(ConfigService);

    jest.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
      if (typeof callback === "function") {
        return callback(prisma);
      }
      return callback;
    });

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("listPublicPlans", () => {
    it("returns active plans sorted by price", async () => {
      jest.spyOn(prisma.subscriptionPlan, "findMany").mockResolvedValue([mockPlan]);

      const plans = await service.listPublicPlans();
      expect(plans).toHaveLength(1);
      expect(plans[0].slug).toBe("club-member");
      expect(plans[0].dailyDownloadQuota).toBe(10);
    });
  });

  describe("getMySubscription", () => {
    it("returns active subscription with daily quota", async () => {
      const mockSub = {
        id: "sub-1",
        userId: "user-1",
        planId: "plan-uuid-1",
        status: SubscriptionStatus.ACTIVE,
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        currentPeriodStart: new Date("2026-09-01"),
        currentPeriodEnd: new Date("2026-10-01"),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialEndsAt: null,
        endedAt: null,
        createdAt: new Date("2026-09-01"),
        updatedAt: new Date("2026-09-01"),
        plan: mockPlan,
      };

      jest.spyOn(prisma.subscription, "findFirst").mockResolvedValue(mockSub);
      jest.spyOn(prisma.downloadEvent, "count").mockResolvedValue(3); // 3 downloads today

      const res = await service.getMySubscription("user-1");
      expect(res.id).toBe("sub-1");
      expect(res.downloadsUsedToday).toBe(3);
      expect(res.quotaRemainingToday).toBe(7); // 10 - 3
    });

    it("throws NotFoundException if no active subscription exists", async () => {
      jest.spyOn(prisma.subscription, "findFirst").mockResolvedValue(null);

      await expect(service.getMySubscription("user-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("createSubscriptionCheckoutSession", () => {
    it("throws NotFoundException when user does not exist", async () => {
      jest.spyOn(prisma.user, "findUnique").mockResolvedValue(null);

      await expect(
        service.createSubscriptionCheckoutSession("user-1", {
          planId: "plan-uuid-1",
          successUrl: "http://localhost/success",
          cancelUrl: "http://localhost/cancel",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ConflictException when user already has an active subscription", async () => {
      jest.spyOn(prisma.user, "findUnique").mockResolvedValue({ id: "user-1" } as any);
      jest.spyOn(prisma.subscriptionPlan, "findUnique").mockResolvedValue(mockPlan);
      jest.spyOn(prisma.subscription, "findFirst").mockResolvedValue({
        id: "sub-existing",
        status: SubscriptionStatus.ACTIVE,
      } as any);

      await expect(
        service.createSubscriptionCheckoutSession("user-1", {
          planId: "plan-uuid-1",
          successUrl: "http://localhost/success",
          cancelUrl: "http://localhost/cancel",
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("creates active subscription and entitlement in mock mode", async () => {
      jest.spyOn(prisma.user, "findUnique").mockResolvedValue({ id: "user-1" } as any);
      jest.spyOn(prisma.subscriptionPlan, "findUnique").mockResolvedValue(mockPlan);
      jest.spyOn(prisma.subscription, "findFirst").mockResolvedValue(null);

      jest.spyOn(prisma.subscription, "create").mockResolvedValue({
        id: "sub-created",
        userId: "user-1",
        planId: mockPlan.id,
        status: SubscriptionStatus.ACTIVE,
        stripeCustomerId: "cus_mock_user",
        stripeSubscriptionId: "sub_mock_123",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialEndsAt: null,
        endedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      jest.spyOn(prisma.product, "findFirst").mockResolvedValue(null);
      jest.spyOn(prisma.product, "create").mockResolvedValue({
        id: "prod-1",
        name: "Membership Product",
        slug: "membership-club",
      } as any);
      jest.spyOn(prisma.productVariant, "findFirst").mockResolvedValue({
        id: "var-1",
        productId: "prod-1",
      } as any);
      jest.spyOn(prisma.order, "create").mockResolvedValue({ id: "ord-1" } as any);
      jest.spyOn(prisma.orderItem, "create").mockResolvedValue({ id: "item-1" } as any);
      jest.spyOn(prisma.entitlement, "create").mockResolvedValue({ id: "ent-1" } as any);

      const res = await service.createSubscriptionCheckoutSession("user-1", {
        planId: "plan-uuid-1",
        successUrl: "http://localhost/success",
        cancelUrl: "http://localhost/cancel",
      });

      expect(res.sessionUrl).toContain("http://localhost/success?session_id=");
      expect(res.sessionId).toBeDefined();
    });
  });

  describe("checkMembershipQuota", () => {
    it("returns allowed: true when daily quota not exhausted", async () => {
      const mockEntitlement = {
        id: "ent-1",
        userId: "user-1",
        status: EntitlementStatus.ACTIVE,
        fulfillmentType: FulfillmentType.MEMBERSHIP_ACCESS,
        subscription: {
          id: "sub-1",
          status: SubscriptionStatus.ACTIVE,
          plan: mockPlan, // quota: 10
        },
      };

      jest.spyOn(prisma.entitlement, "findUnique").mockResolvedValue(mockEntitlement as any);
      jest.spyOn(prisma.downloadEvent, "count").mockResolvedValue(4); // 4 used out of 10

      const res = await service.checkMembershipQuota("user-1", "ent-1");
      expect(res.allowed).toBe(true);
      expect(res.remainingToday).toBe(6);
    });

    it("returns allowed: false when daily quota is exhausted", async () => {
      const mockEntitlement = {
        id: "ent-1",
        userId: "user-1",
        status: EntitlementStatus.ACTIVE,
        fulfillmentType: FulfillmentType.MEMBERSHIP_ACCESS,
        subscription: {
          id: "sub-1",
          status: SubscriptionStatus.ACTIVE,
          plan: mockPlan, // quota: 10
        },
      };

      jest.spyOn(prisma.entitlement, "findUnique").mockResolvedValue(mockEntitlement as any);
      jest.spyOn(prisma.downloadEvent, "count").mockResolvedValue(10); // 10 used out of 10

      const res = await service.checkMembershipQuota("user-1", "ent-1");
      expect(res.allowed).toBe(false);
      expect(res.remainingToday).toBe(0);
    });

    it("throws ForbiddenException when subscription is canceled or unpaid", async () => {
      const mockEntitlement = {
        id: "ent-1",
        userId: "user-1",
        status: EntitlementStatus.ACTIVE,
        fulfillmentType: FulfillmentType.MEMBERSHIP_ACCESS,
        subscription: {
          id: "sub-1",
          status: SubscriptionStatus.CANCELED,
          plan: mockPlan,
        },
      };

      jest.spyOn(prisma.entitlement, "findUnique").mockResolvedValue(mockEntitlement as any);

      await expect(service.checkMembershipQuota("user-1", "ent-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("cancelAdminSubscription", () => {
    it("cancels subscription and revokes linked entitlements", async () => {
      const mockSub = {
        id: "sub-1",
        userId: "user-1",
        planId: "plan-uuid-1",
        status: SubscriptionStatus.ACTIVE,
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialEndsAt: null,
        endedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        plan: mockPlan,
      };

      jest.spyOn(prisma.subscription, "findUnique").mockResolvedValue(mockSub);
      jest.spyOn(prisma.subscription, "update").mockResolvedValue({
        ...mockSub,
        status: SubscriptionStatus.CANCELED,
        canceledAt: new Date(),
        endedAt: new Date(),
      });
      const revokeSpy = jest.spyOn(prisma.entitlement, "updateMany").mockResolvedValue({ count: 1 });

      const res = await service.cancelAdminSubscription("sub-1");
      expect(res.status).toBe(SubscriptionStatus.CANCELED);
      expect(revokeSpy).toHaveBeenCalledWith({
        where: {
          subscriptionId: "sub-1",
          status: EntitlementStatus.ACTIVE,
        },
        data: expect.objectContaining({
          status: EntitlementStatus.REVOKED,
        }),
      });
    });
  });
});
