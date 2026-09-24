import {
  processHostingProvisioningForOrder,
  suspendHostingAccountsForOrder,
  suspendHostingForRevokedEntitlement,
  reconcileHostingUsage,
} from "./hosting-processor";
import {
  prisma,
  FulfillmentType,
  HostingAccountStatus,
  HostingProvider,
} from "@nexus/database";

describe("Hosting Worker Processor", () => {
  const mockServer = {
    id: "srv-worker-1",
    name: "Worker Cloud Server",
    hostname: "wc1.nexusnode.net",
    provider: HostingProvider.MOCK,
    endpointUrl: "https://wc1.nexusnode.net:2083",
    ipAddress: "192.0.2.77",
    maxAccounts: 100,
    activeAccounts: 2,
    authEncryptedToken: JSON.stringify({
      encrypted: "abc",
      iv: "123456789012345678901234",
      tag: "12345678901234567890123456789012",
    }),
    isActive: true,
  };

  const mockOrderWithHosting = {
    id: "ord-host-1",
    orderNumber: "ORD-HOST-1001",
    userId: "usr-client-1",
    user: { id: "usr-client-1", email: "client@test.com" },
    entitlements: [
      {
        id: "ent-host-1",
        fulfillmentType: FulfillmentType.HOSTING_PROVISIONING,
        metadata: { domain: "mysite.com", packagePlan: "standard" },
      },
    ],
  };

  const mockAccount = {
    id: "acc-worker-1",
    userId: "usr-client-1",
    serverId: "srv-worker-1",
    entitlementId: "ent-host-1",
    orderId: "ord-host-1",
    domain: "mysite.com",
    username: "nxmysite12",
    status: HostingAccountStatus.ACTIVE,
    diskUsageMb: 100,
    diskLimitMb: 5120,
    bandwidthUsageMb: 500,
    bandwidthLimitMb: 51200,
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

  describe("processHostingProvisioningForOrder", () => {
    it("provisions hosting account idempotently when order has hosting entitlements", async () => {
      jest.spyOn(prisma.order, "findUnique").mockResolvedValue(mockOrderWithHosting as any);
      jest.spyOn(prisma.hostingAccount, "findUnique").mockResolvedValue(null);
      jest.spyOn(prisma.hostingServer, "findFirst").mockResolvedValue(mockServer as any);
      jest.spyOn(prisma.hostingAccount, "create").mockResolvedValue(mockAccount as any);
      jest.spyOn(prisma.hostingAccount, "update").mockResolvedValue(mockAccount as any);
      jest.spyOn(prisma.hostingServer, "update").mockResolvedValue(mockServer as any);
      jest.spyOn(prisma.hostingDnsRecord, "createMany").mockResolvedValue({ count: 2 });
      jest.spyOn(prisma.outboxEvent, "create").mockResolvedValue({} as any);

      const result = await processHostingProvisioningForOrder("ord-host-1");
      expect(result.provisionedCount).toBe(1);
      expect(prisma.hostingAccount.create).toHaveBeenCalled();
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "HOSTING_ACCOUNT_PROVISIONED",
          }),
        }),
      );
    });

    it("skips provisioning if hosting account already exists for entitlement", async () => {
      jest.spyOn(prisma.order, "findUnique").mockResolvedValue(mockOrderWithHosting as any);
      jest.spyOn(prisma.hostingAccount, "findUnique").mockResolvedValue(mockAccount as any);

      const result = await processHostingProvisioningForOrder("ord-host-1");
      expect(result.provisionedCount).toBe(0);
      expect(prisma.hostingAccount.create).not.toHaveBeenCalled();
    });

    it("does nothing if order has no hosting entitlements", async () => {
      jest.spyOn(prisma.order, "findUnique").mockResolvedValue({
        ...mockOrderWithHosting,
        entitlements: [],
      } as any);

      const result = await processHostingProvisioningForOrder("ord-host-1");
      expect(result.provisionedCount).toBe(0);
    });
  });

  describe("suspendHostingAccountsForOrder", () => {
    it("suspends all active hosting accounts on order refund", async () => {
      jest.spyOn(prisma.hostingAccount, "findMany").mockResolvedValue([mockAccount] as any);
      jest.spyOn(prisma.hostingAccount, "update").mockResolvedValue({
        ...mockAccount,
        status: HostingAccountStatus.SUSPENDED,
      } as any);
      jest.spyOn(prisma.outboxEvent, "create").mockResolvedValue({} as any);

      const res = await suspendHostingAccountsForOrder("ord-host-1", "Refund requested");
      expect(res.suspendedCount).toBe(1);
      expect(prisma.hostingAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: HostingAccountStatus.SUSPENDED,
            suspensionReason: "Refund requested",
          }),
        }),
      );
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "HOSTING_ACCOUNT_SUSPENDED",
          }),
        }),
      );
    });
  });

  describe("suspendHostingForRevokedEntitlement", () => {
    it("suspends hosting account when entitlement is revoked", async () => {
      jest.spyOn(prisma.hostingAccount, "findFirst").mockResolvedValue(mockAccount as any);
      jest.spyOn(prisma.hostingAccount, "update").mockResolvedValue({
        ...mockAccount,
        status: HostingAccountStatus.SUSPENDED,
      } as any);
      jest.spyOn(prisma.outboxEvent, "create").mockResolvedValue({} as any);

      const res = await suspendHostingForRevokedEntitlement("ent-host-1", "License expired");
      expect(res).toBe(true);
      expect(prisma.hostingAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: HostingAccountStatus.SUSPENDED,
            suspensionReason: "License expired",
          }),
        }),
      );
    });
  });

  describe("reconcileHostingUsage", () => {
    it("updates disk and bandwidth metrics for active accounts", async () => {
      jest.spyOn(prisma.hostingAccount, "findMany").mockResolvedValue([mockAccount] as any);
      jest.spyOn(prisma.hostingAccount, "update").mockResolvedValue(mockAccount as any);

      const res = await reconcileHostingUsage({ batchSize: 10 });
      expect(res.reconciledCount).toBe(1);
      expect(prisma.hostingAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "acc-worker-1" },
          data: expect.objectContaining({
            diskUsageMb: 110,
            bandwidthUsageMb: 550,
          }),
        }),
      );
    });
  });
});
