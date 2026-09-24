import { Test, TestingModule } from "@nestjs/testing";
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { HostingService } from "./hosting.service";
import { HostingAdapterFactory } from "./adapters/hosting-adapter.factory";
import { MockHostingAdapter } from "./adapters/mock-hosting.adapter";
import { CpanelHostingAdapter } from "./adapters/cpanel.adapter";
import { DirectAdminHostingAdapter } from "./adapters/directadmin.adapter";
import { CloudflareHostingAdapter } from "./adapters/cloudflare.adapter";
import {
  prisma,
  HostingProvider,
  HostingAccountStatus,
  DnsRecordType,
  DnsRecordStatus,
} from "@nexus/database";
import { encryptHostingCredential } from "@nexus/utils";
import * as crypto from "crypto";

describe("HostingService", () => {
  let service: HostingService;
  let adapterFactory: HostingAdapterFactory;
  let mockAdapter: MockHostingAdapter;

  const TEST_KEY = crypto
    .createHash("sha256")
    .update("nexus_phase14_hosting_infrastructure_secret_encryption_key_2026")
    .digest("hex");

  const encryptedMockToken = JSON.stringify(
    encryptHostingCredential("mock-api-token-12345", TEST_KEY),
  );

  const mockServer = {
    id: "srv-101",
    name: "Production Cpanel Node",
    hostname: "cp1.nexusnode.net",
    provider: HostingProvider.MOCK,
    endpointUrl: "https://cp1.nexusnode.net:2083",
    ipAddress: "192.0.2.55",
    maxAccounts: 100,
    activeAccounts: 5,
    authEncryptedToken: encryptedMockToken,
    isActive: true,
    metadata: null,
    createdAt: new Date("2026-09-01"),
    updatedAt: new Date("2026-09-01"),
  };

  const mockAccount = {
    id: "acc-201",
    userId: "usr-tenant-1",
    serverId: "srv-101",
    entitlementId: "ent-301",
    orderId: "ord-401",
    domain: "clientportal.com",
    username: "nxclient123",
    packagePlan: "starter",
    status: HostingAccountStatus.ACTIVE,
    diskUsageMb: 500,
    diskLimitMb: 5120,
    bandwidthUsageMb: 2000,
    bandwidthLimitMb: 51200,
    suspendedAt: null,
    suspensionReason: null,
    terminatedAt: null,
    metadata: null,
    createdAt: new Date("2026-09-02"),
    updatedAt: new Date("2026-09-02"),
    server: mockServer,
    dnsRecords: [],
  };

  const mockDnsRecord = {
    id: "dns-901",
    hostingAccountId: "acc-201",
    type: DnsRecordType.A,
    name: "@",
    content: "192.0.2.55",
    ttl: 3600,
    priority: null,
    proxied: true,
    cloudflareRecordId: "cf-rec-1",
    status: DnsRecordStatus.ACTIVE,
    metadata: null,
    createdAt: new Date("2026-09-02"),
    updatedAt: new Date("2026-09-02"),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HostingService,
        HostingAdapterFactory,
        MockHostingAdapter,
        CpanelHostingAdapter,
        DirectAdminHostingAdapter,
        CloudflareHostingAdapter,
      ],
    }).compile();

    service = module.get<HostingService>(HostingService);
    adapterFactory = module.get<HostingAdapterFactory>(HostingAdapterFactory);
    mockAdapter = module.get<MockHostingAdapter>(MockHostingAdapter);

    jest.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
      if (typeof callback === "function") {
        return callback(prisma);
      }
      return callback;
    });

    jest.clearAllMocks();
  });

  describe("Server Management", () => {
    it("creates a new hosting server and encrypts its API token", async () => {
      jest.spyOn(prisma.hostingServer, "findUnique").mockResolvedValue(null);
      jest.spyOn(prisma.hostingServer, "create").mockResolvedValue({
        ...mockServer,
        hostname: "da1.nexusnode.net",
      });

      const result = await service.adminCreateServer({
        name: "DirectAdmin Node 1",
        hostname: "da1.nexusnode.net",
        provider: "DIRECTADMIN" as any,
        endpointUrl: "https://da1.nexusnode.net:2222",
        ipAddress: "198.51.100.10",
        apiToken: "da-admin-key-supersecret",
      });

      expect(result.hostname).toBe("da1.nexusnode.net");
      expect(prisma.hostingServer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            hostname: "da1.nexusnode.net",
            authEncryptedToken: expect.stringContaining("encrypted"),
          }),
        }),
      );
    });

    it("rejects server creation when hostname already exists", async () => {
      jest.spyOn(prisma.hostingServer, "findUnique").mockResolvedValue(mockServer as any);

      await expect(
        service.adminCreateServer({
          name: "Duplicate Node",
          hostname: "cp1.nexusnode.net",
          provider: "CPANEL" as any,
          endpointUrl: "https://cp1.nexusnode.net:2083",
          ipAddress: "192.0.2.55",
          apiToken: "token",
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("prevents deletion of server when active accounts are assigned", async () => {
      jest.spyOn(prisma.hostingServer, "findUnique").mockResolvedValue({
        ...mockServer,
        accounts: [mockAccount],
      } as any);

      await expect(service.adminDeleteServer("srv-101")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("deletes server when no accounts are assigned", async () => {
      jest.spyOn(prisma.hostingServer, "findUnique").mockResolvedValue({
        ...mockServer,
        accounts: [],
      } as any);
      jest.spyOn(prisma.hostingServer, "delete").mockResolvedValue(mockServer as any);

      const result = await service.adminDeleteServer("srv-101");
      expect(result.success).toBe(true);
      expect(prisma.hostingServer.delete).toHaveBeenCalledWith({ where: { id: "srv-101" } });
    });
  });

  describe("Customer Tenant-Isolated Operations", () => {
    it("lists only accounts belonging to requesting user", async () => {
      jest
        .spyOn(prisma.hostingAccount, "findMany")
        .mockResolvedValue([mockAccount] as any);

      const accounts = await service.listMyAccounts("usr-tenant-1");
      expect(accounts).toHaveLength(1);
      expect(accounts[0].userId).toBe("usr-tenant-1");
      expect(prisma.hostingAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "usr-tenant-1" } }),
      );
    });

    it("rejects getMyAccount when account belongs to different tenant", async () => {
      jest.spyOn(prisma.hostingAccount, "findFirst").mockResolvedValue(null);

      await expect(service.getMyAccount("attacker-user", "acc-201")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("generates one-time SSO redirect URL for active hosting account", async () => {
      jest.spyOn(prisma.hostingAccount, "findFirst").mockResolvedValue(mockAccount as any);

      const sso = await service.generateSsoUrl("usr-tenant-1", "acc-201");
      expect(sso.ssoUrl).toContain("https://cp1.nexusnode.net:2083");
      expect(sso.ssoUrl).toContain("user=nxclient123");
    });

    it("refuses SSO token generation if account is SUSPENDED", async () => {
      jest.spyOn(prisma.hostingAccount, "findFirst").mockResolvedValue({
        ...mockAccount,
        status: HostingAccountStatus.SUSPENDED,
      } as any);

      await expect(
        service.generateSsoUrl("usr-tenant-1", "acc-201"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("DNS Management & Validation", () => {
    it("creates valid A record for hosted domain", async () => {
      jest.spyOn(prisma.hostingAccount, "findFirst").mockResolvedValue(mockAccount as any);
      jest.spyOn(prisma.hostingDnsRecord, "findFirst").mockResolvedValue(null);
      jest.spyOn(prisma.hostingDnsRecord, "create").mockResolvedValue(mockDnsRecord as any);

      const record = await service.createDnsRecord("usr-tenant-1", "acc-201", {
        type: DnsRecordType.A,
        name: "@",
        content: "192.0.2.55",
        ttl: 3600,
        proxied: true,
      });

      expect(record.type).toBe("A");
      expect(record.name).toBe("@");
      expect(record.content).toBe("192.0.2.55");
    });

    it("rejects invalid IPv4 content for A record", async () => {
      jest.spyOn(prisma.hostingAccount, "findFirst").mockResolvedValue(mockAccount as any);

      await expect(
        service.createDnsRecord("usr-tenant-1", "acc-201", {
          type: DnsRecordType.A,
          name: "@",
          content: "999.999.999.999",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects CNAME record on apex (@)", async () => {
      jest.spyOn(prisma.hostingAccount, "findFirst").mockResolvedValue(mockAccount as any);

      await expect(
        service.createDnsRecord("usr-tenant-1", "acc-201", {
          type: DnsRecordType.CNAME,
          name: "@",
          content: "external.com",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("deletes DNS record tenant-safely", async () => {
      jest.spyOn(prisma.hostingAccount, "findFirst").mockResolvedValue(mockAccount as any);
      jest.spyOn(prisma.hostingDnsRecord, "findFirst").mockResolvedValue(mockDnsRecord as any);
      jest.spyOn(prisma.hostingDnsRecord, "delete").mockResolvedValue(mockDnsRecord as any);

      const res = await service.deleteDnsRecord("usr-tenant-1", "acc-201", "dns-901");
      expect(res.success).toBe(true);
      expect(prisma.hostingDnsRecord.delete).toHaveBeenCalledWith({ where: { id: "dns-901" } });
    });
  });

  describe("Lifecycle & Authoritative Provisioning", () => {
    it("provisions hosting account idempotently and seeds DNS records", async () => {
      jest
        .spyOn(prisma.hostingAccount, "findUnique")
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          ...mockAccount,
          status: HostingAccountStatus.ACTIVE,
          dnsRecords: [mockDnsRecord],
        } as any);
      jest.spyOn(prisma.hostingServer, "findFirst").mockResolvedValue(mockServer as any);
      jest.spyOn(prisma.hostingAccount, "create").mockResolvedValue({
        ...mockAccount,
        status: HostingAccountStatus.PROVISIONING,
      } as any);
      jest.spyOn(prisma.hostingAccount, "update").mockResolvedValue({
        ...mockAccount,
        status: HostingAccountStatus.ACTIVE,
      } as any);
      jest.spyOn(prisma.hostingServer, "update").mockResolvedValue(mockServer as any);
      jest.spyOn(prisma.hostingDnsRecord, "createMany").mockResolvedValue({ count: 2 });
      jest.spyOn(prisma.outboxEvent, "create").mockResolvedValue({} as any);

      const account = await service.provisionAccountInternal({
        userId: "usr-tenant-1",
        domain: "newsite.org",
      });

      expect(account.status).toBe("ACTIVE");
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "HOSTING_ACCOUNT_PROVISIONED",
          }),
        }),
      );
    });

    it("rejects provisioning with invalid domain name syntax", async () => {
      await expect(
        service.provisionAccountInternal({
          userId: "usr-tenant-1",
          domain: "https://bad-protocol.com/path",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("suspends active account and records outbox event", async () => {
      jest.spyOn(prisma.hostingAccount, "findUnique").mockResolvedValue(mockAccount as any);
      jest.spyOn(prisma.hostingAccount, "update").mockResolvedValue({
        ...mockAccount,
        status: HostingAccountStatus.SUSPENDED,
        suspendedAt: new Date(),
        suspensionReason: "Non-payment",
      } as any);
      jest.spyOn(prisma.outboxEvent, "create").mockResolvedValue({} as any);

      const suspended = await service.adminSuspendAccount("acc-201", {
        reason: "Non-payment",
      });

      expect(suspended.status).toBe("SUSPENDED");
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "HOSTING_ACCOUNT_SUSPENDED",
          }),
        }),
      );
    });

    it("unsuspends suspended account back to ACTIVE", async () => {
      jest.spyOn(prisma.hostingAccount, "findUnique").mockResolvedValue({
        ...mockAccount,
        status: HostingAccountStatus.SUSPENDED,
      } as any);
      jest.spyOn(prisma.hostingAccount, "update").mockResolvedValue({
        ...mockAccount,
        status: HostingAccountStatus.ACTIVE,
      } as any);
      jest.spyOn(prisma.outboxEvent, "create").mockResolvedValue({} as any);

      const reactivated = await service.adminUnsuspendAccount("acc-201");
      expect(reactivated.status).toBe("ACTIVE");
      expect(prisma.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "HOSTING_ACCOUNT_UNSUSPENDED",
          }),
        }),
      );
    });

    it("terminates account and decrements server active accounts", async () => {
      jest.spyOn(prisma.hostingAccount, "findUnique").mockResolvedValue(mockAccount as any);
      jest.spyOn(prisma.hostingAccount, "update").mockResolvedValue({
        ...mockAccount,
        status: HostingAccountStatus.TERMINATED,
        terminatedAt: new Date(),
      } as any);
      jest.spyOn(prisma.hostingServer, "update").mockResolvedValue(mockServer as any);
      jest.spyOn(prisma.outboxEvent, "create").mockResolvedValue({} as any);

      const terminated = await service.adminTerminateAccount("acc-201");
      expect(terminated.status).toBe("TERMINATED");
      expect(prisma.hostingServer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { activeAccounts: { decrement: 1 } },
        }),
      );
    });
  });

  describe("Usage & Metric Reconciliation", () => {
    it("syncs account usage from provider adapter", async () => {
      jest.spyOn(prisma.hostingAccount, "findUnique").mockResolvedValue(mockAccount as any);
      jest.spyOn(prisma.hostingAccount, "update").mockResolvedValue(mockAccount as any);

      const usage = await service.syncAccountUsage("acc-201");
      expect(usage.diskUsageMb).toBe(512);
      expect(usage.bandwidthUsageMb).toBe(2048);
      expect(prisma.hostingAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "acc-201" },
          data: expect.objectContaining({
            diskUsageMb: 512,
            bandwidthUsageMb: 2048,
          }),
        }),
      );
    });

    it("suspends hosting account when entitlement is revoked", async () => {
      jest.spyOn(prisma.hostingAccount, "findFirst").mockResolvedValue(mockAccount as any);
      jest.spyOn(prisma.hostingAccount, "update").mockResolvedValue(mockAccount as any);

      const success = await service.suspendAccountForRevocation("ent-301", "Entitlement revoked");
      expect(success).toBe(true);
      expect(prisma.hostingAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: HostingAccountStatus.SUSPENDED,
            suspensionReason: "Entitlement revoked",
          }),
        }),
      );
    });
  });
});
