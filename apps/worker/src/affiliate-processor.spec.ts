import {
  processAffiliateReferralForOrder,
  clawbackAffiliateReferralForOrder,
  reconcileMatureAffiliateReferrals,
} from "./affiliate-processor";
import {
  prisma,
  AffiliateStatus,
  ReferralStatus,
} from "@nexus/database";

describe("affiliate-processor", () => {
  const mockAccount = {
    id: "aff-1",
    userId: "user-aff-1",
    code: "PARTNER10",
    status: AffiliateStatus.ACTIVE,
    commissionRateBp: 1500, // 15%
    totalEarnedMinor: BigInt(0),
    pendingBalanceMinor: BigInt(0),
    availableBalanceMinor: BigInt(0),
  };

  beforeEach(() => {
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

  describe("processAffiliateReferralForOrder", () => {
    it("returns null if order has no affiliate tracking", async () => {
      jest.spyOn(prisma.order, "findUnique").mockResolvedValue({
        id: "ord-1",
        affiliateId: null,
        affiliateCode: null,
      } as any);

      const res = await processAffiliateReferralForOrder("ord-1");
      expect(res).toBeNull();
    });

    it("blocks self-referral when order user is affiliate user", async () => {
      jest.spyOn(prisma.order, "findUnique").mockResolvedValue({
        id: "ord-1",
        userId: "user-aff-1", // SAME as affiliate
        affiliateId: "aff-1",
        totalAmount: 10000,
      } as any);
      jest.spyOn(prisma.affiliateAccount, "findUnique").mockResolvedValue(mockAccount as any);

      const res = await processAffiliateReferralForOrder("ord-1");
      expect(res).toBeNull();
    });

    it("creates pending referral and increments balances for valid order", async () => {
      jest.spyOn(prisma.order, "findUnique").mockResolvedValue({
        id: "ord-1",
        userId: "customer-99",
        affiliateId: "aff-1",
        totalAmount: 10000,
      } as any);
      jest.spyOn(prisma.affiliateAccount, "findUnique").mockResolvedValue(mockAccount as any);
      jest.spyOn(prisma.affiliateReferral, "findUnique").mockResolvedValue(null);

      const createSpy = jest.spyOn(prisma.affiliateReferral, "create").mockResolvedValue({
        id: "ref-1",
        affiliateId: "aff-1",
        orderId: "ord-1",
        customerUserId: "customer-99",
        orderAmountMinor: 10000,
        commissionAmountMinor: 1500, // 15% of 10000
        status: ReferralStatus.PENDING,
      } as any);

      const updateSpy = jest.spyOn(prisma.affiliateAccount, "update").mockResolvedValue({} as any);

      const res = await processAffiliateReferralForOrder("ord-1");
      expect(res).toBeDefined();
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: "ord-1",
            commissionAmountMinor: 1500,
            status: ReferralStatus.PENDING,
          }),
        }),
      );
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            pendingBalanceMinor: { increment: BigInt(1500) },
            totalEarnedMinor: { increment: BigInt(1500) },
          },
        }),
      );
    });

    it("is idempotent when referral already exists for order", async () => {
      const existingRef = {
        id: "ref-existing",
        orderId: "ord-1",
        status: ReferralStatus.PENDING,
      };

      jest.spyOn(prisma.order, "findUnique").mockResolvedValue({
        id: "ord-1",
        userId: "customer-99",
        affiliateId: "aff-1",
        totalAmount: 10000,
      } as any);
      jest.spyOn(prisma.affiliateAccount, "findUnique").mockResolvedValue(mockAccount as any);
      jest.spyOn(prisma.affiliateReferral, "findUnique").mockResolvedValue(existingRef as any);

      const res = await processAffiliateReferralForOrder("ord-1");
      expect(res).toBe(existingRef);
    });
  });

  describe("clawbackAffiliateReferralForOrder", () => {
    it("reverses pending referral on refund", async () => {
      const pendingRef = {
        id: "ref-1",
        affiliateId: "aff-1",
        orderId: "ord-1",
        commissionAmountMinor: 1500,
        status: ReferralStatus.PENDING,
      };

      jest.spyOn(prisma.affiliateReferral, "findUnique").mockResolvedValue(pendingRef as any);
      const updateRefSpy = jest.spyOn(prisma.affiliateReferral, "update").mockResolvedValue({} as any);
      const updateAccSpy = jest.spyOn(prisma.affiliateAccount, "update").mockResolvedValue({} as any);

      const res = await clawbackAffiliateReferralForOrder("ord-1", "ORDER_REFUNDED");
      expect(res).toBe(true);
      expect(updateRefSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReferralStatus.REJECTED,
          }),
        }),
      );
      expect(updateAccSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            pendingBalanceMinor: { decrement: BigInt(1500) },
            totalEarnedMinor: { decrement: BigInt(1500) },
          },
        }),
      );
    });
  });

  describe("reconcileMatureAffiliateReferrals", () => {
    it("transitions mature pending referrals to approved and shifts balance", async () => {
      const matureRef = {
        id: "ref-mature-1",
        affiliateId: "aff-1",
        commissionAmountMinor: 2500,
        status: ReferralStatus.PENDING,
      };

      jest.spyOn(prisma.affiliateReferral, "findMany").mockResolvedValue([matureRef] as any);
      jest.spyOn(prisma.affiliateReferral, "updateMany").mockResolvedValue({ count: 1 });
      const updateAccSpy = jest.spyOn(prisma.affiliateAccount, "update").mockResolvedValue({} as any);

      const res = await reconcileMatureAffiliateReferrals(10);
      expect(res.approvedCount).toBe(1);
      expect(updateAccSpy).toHaveBeenCalledWith({
        where: { id: "aff-1" },
        data: {
          pendingBalanceMinor: { decrement: BigInt(2500) },
          availableBalanceMinor: { increment: BigInt(2500) },
        },
      });
    });
  });
});
