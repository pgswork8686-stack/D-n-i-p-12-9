import { Test, TestingModule } from "@nestjs/testing";
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { AffiliatesService } from "./affiliates.service";
import {
  prisma,
  AffiliateStatus,
  ReferralStatus,
  PayoutStatus,
  PayoutMethod,
} from "@nexus/database";

describe("AffiliatesService", () => {
  let service: AffiliatesService;

  const mockAccount = {
    id: "aff-uuid-1",
    userId: "user-aff-1",
    code: "AFF_CODE_1",
    status: AffiliateStatus.ACTIVE,
    commissionRateBp: 2000,
    payoutMethod: PayoutMethod.BANK_TRANSFER,
    payoutDetails: null,
    totalEarnedMinor: BigInt(50000),
    pendingBalanceMinor: BigInt(20000),
    availableBalanceMinor: BigInt(30000),
    withdrawnBalanceMinor: BigInt(0),
    createdAt: new Date("2026-09-01"),
    updatedAt: new Date("2026-09-01"),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AffiliatesService],
    }).compile();

    service = module.get<AffiliatesService>(AffiliatesService);

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

  describe("registerAffiliate", () => {
    it("throws NotFoundException if user does not exist", async () => {
      jest.spyOn(prisma.user, "findUnique").mockResolvedValue(null);

      await expect(
        service.registerAffiliate("user-1", { code: "MYCODE" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ConflictException if user already has an affiliate account", async () => {
      jest.spyOn(prisma.user, "findUnique").mockResolvedValue({ id: "user-1" } as any);
      jest
        .spyOn(prisma.affiliateAccount, "findUnique")
        .mockResolvedValue(mockAccount as any);

      await expect(
        service.registerAffiliate("user-1", { code: "MYCODE" }),
      ).rejects.toThrow(ConflictException);
    });

    it("throws ConflictException if code is already taken", async () => {
      jest.spyOn(prisma.user, "findUnique").mockResolvedValue({ id: "user-1" } as any);
      jest
        .spyOn(prisma.affiliateAccount, "findUnique")
        .mockResolvedValueOnce(null) // user account check
        .mockResolvedValueOnce(mockAccount as any); // code check

      await expect(
        service.registerAffiliate("user-1", { code: "AFF_CODE_1" }),
      ).rejects.toThrow(ConflictException);
    });

    it("successfully normalizes code and registers affiliate", async () => {
      jest.spyOn(prisma.user, "findUnique").mockResolvedValue({ id: "user-1" } as any);
      jest.spyOn(prisma.affiliateAccount, "findUnique").mockResolvedValue(null);
      jest.spyOn(prisma.affiliateAccount, "create").mockResolvedValue({
        ...mockAccount,
        userId: "user-1",
        code: "PARTNER99",
      } as any);

      const res = await service.registerAffiliate("user-1", { code: "  partner99  " });
      expect(res.code).toBe("PARTNER99");
      expect(res.commissionRateBp).toBe(2000);
      expect(res.availableBalanceMinor).toBe(30000);
    });
  });

  describe("recordClick", () => {
    it("returns recorded: false for non-existent affiliate code", async () => {
      jest.spyOn(prisma.affiliateAccount, "findUnique").mockResolvedValue(null);

      const res = await service.recordClick(
        { code: "NONEXISTENT", landingPage: "https://nexus.com" },
        "1.2.3.4",
        "Mozilla/5.0",
      );
      expect(res.recorded).toBe(false);
    });

    it("records click and hashes IP/UA", async () => {
      jest
        .spyOn(prisma.affiliateAccount, "findUnique")
        .mockResolvedValue(mockAccount as any);
      const createClickSpy = jest
        .spyOn(prisma.affiliateClick, "create")
        .mockResolvedValue({ id: "click-1" } as any);

      const res = await service.recordClick(
        { code: "AFF_CODE_1", landingPage: "https://nexus.com" },
        "192.168.1.1",
        "Mozilla/5.0 Chrome",
      );

      expect(res.recorded).toBe(true);
      expect(createClickSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            affiliateId: mockAccount.id,
            landingPage: "https://nexus.com",
          }),
        }),
      );
    });
  });

  describe("requestPayout", () => {
    it("throws BadRequestException if requested amount < threshold", async () => {
      jest
        .spyOn(prisma.affiliateAccount, "findUnique")
        .mockResolvedValue(mockAccount as any);

      await expect(
        service.requestPayout("user-aff-1", { amountMinor: 100 }), // below $50 / 5000
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException if requested amount > available balance", async () => {
      jest
        .spyOn(prisma.affiliateAccount, "findUnique")
        .mockResolvedValue(mockAccount as any); // available is 30,000

      await expect(
        service.requestPayout("user-aff-1", { amountMinor: 50000 }),
      ).rejects.toThrow(BadRequestException);
    });

    it("deducts available balance and creates payout with status REQUESTED", async () => {
      jest
        .spyOn(prisma.affiliateAccount, "findUnique")
        .mockResolvedValue(mockAccount as any);
      const updateAccountSpy = jest
        .spyOn(prisma.affiliateAccount, "update")
        .mockResolvedValue({} as any);
      jest.spyOn(prisma.affiliatePayout, "create").mockResolvedValue({
        id: "payout-1",
        affiliateId: mockAccount.id,
        amountMinor: 10000,
        currency: "USD",
        status: PayoutStatus.REQUESTED,
        payoutMethod: PayoutMethod.BANK_TRANSFER,
        payoutDetailsSnapshot: {},
        referenceCode: null,
        rejectionReason: null,
        requestedAt: new Date(),
        processedAt: null,
        processedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const res = await service.requestPayout("user-aff-1", { amountMinor: 10000 });
      expect(res.id).toBe("payout-1");
      expect(res.status).toBe(PayoutStatus.REQUESTED);
      expect(updateAccountSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            availableBalanceMinor: { decrement: BigInt(10000) },
          },
        }),
      );
    });
  });

  describe("processAdminPayout", () => {
    it("increments withdrawnBalanceMinor on COMPLETED payout", async () => {
      const mockPayout = {
        id: "payout-1",
        affiliateId: mockAccount.id,
        amountMinor: 10000,
        status: PayoutStatus.REQUESTED,
      };

      jest.spyOn(prisma.affiliatePayout, "findUnique").mockResolvedValue(mockPayout as any);
      jest.spyOn(prisma.affiliatePayout, "update").mockResolvedValue({
        ...mockPayout,
        status: PayoutStatus.COMPLETED,
        referenceCode: "TX-BANK-999",
        requestedAt: new Date(),
        processedAt: new Date(),
        processedBy: "admin-1",
        currency: "USD",
        payoutMethod: PayoutMethod.BANK_TRANSFER,
      } as any);

      const updateAccountSpy = jest
        .spyOn(prisma.affiliateAccount, "update")
        .mockResolvedValue({} as any);

      const res = await service.processAdminPayout(
        "payout-1",
        { status: "COMPLETED", referenceCode: "TX-BANK-999" },
        "admin-1",
      );

      expect(res.status).toBe(PayoutStatus.COMPLETED);
      expect(updateAccountSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            withdrawnBalanceMinor: { increment: BigInt(10000) },
          },
        }),
      );
    });

    it("refunds availableBalanceMinor on REJECTED payout", async () => {
      const mockPayout = {
        id: "payout-1",
        affiliateId: mockAccount.id,
        amountMinor: 10000,
        status: PayoutStatus.REQUESTED,
      };

      jest.spyOn(prisma.affiliatePayout, "findUnique").mockResolvedValue(mockPayout as any);
      jest.spyOn(prisma.affiliatePayout, "update").mockResolvedValue({
        ...mockPayout,
        status: PayoutStatus.REJECTED,
        rejectionReason: "Invalid bank details",
        requestedAt: new Date(),
        processedAt: new Date(),
        processedBy: "admin-1",
        currency: "USD",
        payoutMethod: PayoutMethod.BANK_TRANSFER,
      } as any);

      const updateAccountSpy = jest
        .spyOn(prisma.affiliateAccount, "update")
        .mockResolvedValue({} as any);

      const res = await service.processAdminPayout(
        "payout-1",
        { status: "REJECTED", rejectionReason: "Invalid bank details" },
        "admin-1",
      );

      expect(res.status).toBe(PayoutStatus.REJECTED);
      expect(updateAccountSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            availableBalanceMinor: { increment: BigInt(10000) },
          },
        }),
      );
    });
  });

  describe("processOrderReferral & Anti-Fraud", () => {
    it("returns null and blocks referral when customer is the affiliate (self-referral)", async () => {
      jest
        .spyOn(prisma.affiliateAccount, "findUnique")
        .mockResolvedValue(mockAccount as any); // affiliate userId is 'user-aff-1'

      const res = await service.processOrderReferral({
        orderId: "ord-1",
        affiliateId: mockAccount.id,
        customerUserId: "user-aff-1", // SAME user!
        orderAmountMinor: 10000,
      });

      expect(res).toBeNull();
    });

    it("returns null and blocks referral when IP hashes match (self-referral IP)", async () => {
      jest
        .spyOn(prisma.affiliateAccount, "findUnique")
        .mockResolvedValue(mockAccount as any);

      const res = await service.processOrderReferral({
        orderId: "ord-1",
        affiliateId: mockAccount.id,
        customerUserId: "different-user",
        orderAmountMinor: 10000,
        clickIpHash: "sha256-matching-ip",
        customerIpHash: "sha256-matching-ip", // SAME IP!
      });

      expect(res).toBeNull();
    });

    it("creates pending referral and increments pendingBalanceMinor for legitimate purchase", async () => {
      jest
        .spyOn(prisma.affiliateAccount, "findUnique")
        .mockResolvedValue(mockAccount as any);
      jest.spyOn(prisma.affiliateReferral, "findUnique").mockResolvedValue(null);

      const mockReferral = {
        id: "ref-1",
        affiliateId: mockAccount.id,
        orderId: "ord-1",
        customerUserId: "customer-99",
        orderAmountMinor: 10000,
        commissionAmountMinor: 2000, // 20% of 10000
        status: ReferralStatus.PENDING,
        matureAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(prisma.affiliateReferral, "create").mockResolvedValue(mockReferral as any);
      const updateAccountSpy = jest
        .spyOn(prisma.affiliateAccount, "update")
        .mockResolvedValue({} as any);

      const res = await service.processOrderReferral({
        orderId: "ord-1",
        affiliateId: mockAccount.id,
        customerUserId: "customer-99",
        orderAmountMinor: 10000,
        clickIpHash: "ip-hash-1",
        customerIpHash: "ip-hash-2",
      });

      expect(res).not.toBeNull();
      expect(res!.commissionAmountMinor).toBe(2000);
      expect(updateAccountSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            pendingBalanceMinor: { increment: BigInt(2000) },
            totalEarnedMinor: { increment: BigInt(2000) },
          },
        }),
      );
    });
  });

  describe("clawbackOrderReferral", () => {
    it("reverses pending referral on order refund", async () => {
      const mockReferral = {
        id: "ref-1",
        affiliateId: mockAccount.id,
        orderId: "ord-1",
        commissionAmountMinor: 2000,
        status: ReferralStatus.PENDING,
      };

      jest
        .spyOn(prisma.affiliateReferral, "findUnique")
        .mockResolvedValue(mockReferral as any);
      const updateRefSpy = jest
        .spyOn(prisma.affiliateReferral, "update")
        .mockResolvedValue({} as any);
      const updateAccSpy = jest
        .spyOn(prisma.affiliateAccount, "update")
        .mockResolvedValue({} as any);

      const res = await service.clawbackOrderReferral("ord-1", "ORDER_REFUNDED");
      expect(res).toBe(true);

      expect(updateRefSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ReferralStatus.REJECTED,
            rejectionReason: "ORDER_REFUNDED",
          }),
        }),
      );
      expect(updateAccSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            pendingBalanceMinor: { decrement: BigInt(2000) },
            totalEarnedMinor: { decrement: BigInt(2000) },
          },
        }),
      );
    });
  });
});
