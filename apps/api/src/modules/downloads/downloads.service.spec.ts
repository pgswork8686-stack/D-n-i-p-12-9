import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { HttpException, HttpStatus } from "@nestjs/common";
import { DownloadsService } from "./downloads.service";
import { DownloadRateLimiter } from "./download-rate-limiter";
import { STORAGE_SERVICE } from "../storage/storage.interface";
import * as dbEngine from "@nexus/database";

jest.mock("@nexus/database", () => {
  const actual = jest.requireActual("@nexus/database");
  return {
    ...actual,
    prisma: {
      entitlement: {
        findUnique: jest.fn(),
      },
      internalLicense: {
        findUnique: jest.fn(),
      },
    },
    createProductVersion: jest.fn(),
    listProductVersions: jest.fn(),
    getProductVersionById: jest.fn(),
    registerVerifiedUploadedFile: jest.fn(),
    publishProductVersion: jest.fn(),
    issueCustomerDownloadGrant: jest.fn(),
    issueUpdaterDownloadGrant: jest.fn(),
    recordDownloadIssuance: jest.fn(),
  };
});

describe("DownloadsService", () => {
  let service: DownloadsService;
  let mockStorageService: any;
  let mockRateLimiter: any;
  let mockConfigService: any;

  beforeEach(async () => {
    mockStorageService = {
      headObject: jest.fn(),
      verifyObjectIntegrity: jest.fn(),
      createSignedDownloadUrl: jest.fn(),
      uploadFile: jest.fn(),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };

    mockRateLimiter = {
      checkAndConsumeCustomerRateLimit: jest.fn().mockResolvedValue(undefined),
      checkAndConsumeUpdaterRateLimit: jest.fn().mockResolvedValue(undefined),
      checkAndConsumeRateLimit: jest.fn().mockResolvedValue(undefined),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue("180"),
    };

    (dbEngine.recordDownloadIssuance as jest.Mock).mockResolvedValue({
      event: { id: "ev-recorded" },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DownloadsService,
        {
          provide: STORAGE_SERVICE,
          useValue: mockStorageService,
        },
        {
          provide: DownloadRateLimiter,
          useValue: mockRateLimiter,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<DownloadsService>(DownloadsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("createVersion", () => {
    it("calls domain engine to create DRAFT version", async () => {
      const mockResult = {
        id: "v-1",
        productId: "p-1",
        version: "1.0.0",
        status: "DRAFT",
      };
      (dbEngine.createProductVersion as jest.Mock).mockResolvedValue(mockResult);

      const res = await service.createVersion("p-1", { version: "1.0.0" }, "admin-1");
      expect(res).toEqual(mockResult);
      expect(dbEngine.createProductVersion).toHaveBeenCalledWith({
        productId: "p-1",
        version: "1.0.0",
        releaseNotes: undefined,
        actorId: "admin-1",
      });
    });
  });

  describe("uploadFile", () => {
    it("authoritatively computes SHA and size, streams to storage, and registers file", async () => {
      (dbEngine.getProductVersionById as jest.Mock).mockResolvedValue({
        id: "v-1",
        productId: "p-1",
        status: "DRAFT",
      });

      mockStorageService.uploadFile.mockResolvedValue("key.zip");
      mockStorageService.verifyObjectIntegrity.mockResolvedValue({ valid: true });
      (dbEngine.registerVerifiedUploadedFile as jest.Mock).mockImplementation(async (params: any) => {
        if (typeof params.verifyUploadedObject === "function") {
          await params.verifyUploadedObject(params.storageKey);
        }
        return {
          id: "f-uploaded",
          productVersionId: "v-1",
          fileName: "plugin.zip",
          isPrimary: true,
        };
      });

      const dummyFile = {
        originalname: "plugin.zip",
        buffer: Buffer.from("dummy-zip-content"),
        mimetype: "application/zip",
        size: 17,
      };

      const res = await service.uploadFile("v-1", dummyFile, true, "admin-1");
      expect(res.id).toBe("f-uploaded");
      expect(mockStorageService.uploadFile).toHaveBeenCalled();
      expect(mockStorageService.verifyObjectIntegrity).toHaveBeenCalled();
      expect(dbEngine.registerVerifiedUploadedFile).toHaveBeenCalled();
      expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
    });

    it("cleans up orphaned storage object when DB file registration fails", async () => {
      (dbEngine.getProductVersionById as jest.Mock).mockResolvedValue({
        id: "v-1",
        productId: "p-1",
        status: "DRAFT",
      });

      mockStorageService.uploadFile.mockResolvedValue("products/p-1/versions/v-1/uuid-plugin.zip");
      mockStorageService.verifyObjectIntegrity.mockResolvedValue({ valid: true });
      (dbEngine.registerVerifiedUploadedFile as jest.Mock).mockRejectedValue(new Error("DB insertion failed"));

      const dummyFile = {
        originalname: "plugin.zip",
        buffer: Buffer.from("dummy-zip-content"),
        mimetype: "application/zip",
        size: 17,
      };

      await expect(
        service.uploadFile("v-1", dummyFile, true, "admin-1"),
      ).rejects.toThrow();

      expect(mockStorageService.deleteObject).toHaveBeenCalled();
    });
  });

  describe("publishVersion", () => {
    it("calls publishProductVersion with storage verification callback", async () => {
      (dbEngine.publishProductVersion as jest.Mock).mockResolvedValue({
        success: true,
        version: { id: "v-1", status: "PUBLISHED" },
      });

      const res = await service.publishVersion("v-1", "admin-1");
      expect(res.success).toBe(true);
      expect(dbEngine.publishProductVersion).toHaveBeenCalled();
    });
  });

  describe("requestDownload", () => {
    it("checks preflight ownership, enforces rate limit, issues grant, signs URL, and records issuance", async () => {
      (dbEngine.prisma.entitlement.findUnique as jest.Mock).mockResolvedValue({
        id: "ent-1",
        userId: "u-1",
      });

      (dbEngine.issueCustomerDownloadGrant as jest.Mock).mockResolvedValue({
        grant: { id: "grant-1", issuedAt: new Date() },
        version: { id: "v-1", productId: "p-1" },
        file: {
          id: "f-1",
          storageKey: "products/p-1/versions/v-1/file.zip",
          fileName: "file.zip",
          contentType: "application/zip",
          sizeBytes: 2048,
          sha256: "hash123",
        },
      });

      mockStorageService.headObject.mockResolvedValue({ contentLength: 2048 });
      mockStorageService.createSignedDownloadUrl.mockResolvedValue(
        "https://r2.storage/signed-url",
      );

      const res = await service.requestDownload(
        "u-1",
        {
          entitlementId: "ent-1",
          versionId: "v-1",
          fileId: "f-1",
        },
        "127.0.0.1",
        "Mozilla/5.0",
      );

      expect(dbEngine.prisma.entitlement.findUnique).toHaveBeenCalledWith({
        where: { id: "ent-1" },
      });
      expect(mockRateLimiter.checkAndConsumeCustomerRateLimit).toHaveBeenCalledWith(
        "u-1",
        "ent-1",
      );
      expect(dbEngine.issueCustomerDownloadGrant).toHaveBeenCalledWith({
        userId: "u-1",
        entitlementId: "ent-1",
        versionId: "v-1",
        fileId: "f-1",
        ttlSeconds: 180,
        ipAddress: "127.0.0.1",
        userAgent: "Mozilla/5.0",
      });
      expect(mockStorageService.headObject).toHaveBeenCalledWith(
        "products/p-1/versions/v-1/file.zip",
      );
      expect(dbEngine.recordDownloadIssuance).toHaveBeenCalledWith({
        grantId: "grant-1",
        ipAddress: "127.0.0.1",
        userAgent: "Mozilla/5.0",
      });
      expect(res.downloadUrl).toBe("https://r2.storage/signed-url");
      expect(res.expiresIn).toBe(180);
    });

    it("fails closed with 503 and records NO issuance if storage object is missing", async () => {
      (dbEngine.prisma.entitlement.findUnique as jest.Mock).mockResolvedValue({
        id: "ent-1",
        userId: "u-1",
      });

      (dbEngine.issueCustomerDownloadGrant as jest.Mock).mockResolvedValue({
        grant: { id: "grant-1", issuedAt: new Date() },
        version: { id: "v-1", productId: "p-1" },
        file: {
          id: "f-1",
          storageKey: "products/p-1/versions/v-1/missing.zip",
          fileName: "missing.zip",
          contentType: "application/zip",
          sizeBytes: 2048,
          sha256: "hash123",
        },
      });

      mockStorageService.headObject.mockResolvedValue(null);

      await expect(
        service.requestDownload(
          "u-1",
          { entitlementId: "ent-1", versionId: "v-1", fileId: "f-1" },
        ),
      ).rejects.toThrow(HttpException);

      expect(dbEngine.recordDownloadIssuance).not.toHaveBeenCalled();
    });

    it("rejects unauthorized entitlement preflight before touching rate limiter", async () => {
      (dbEngine.prisma.entitlement.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.requestDownload(
          "u-1",
          { entitlementId: "random-uuid", versionId: "v-1", fileId: "f-1" },
        ),
      ).rejects.toThrow(HttpException);

      expect(mockRateLimiter.checkAndConsumeCustomerRateLimit).not.toHaveBeenCalled();
    });
  });

  describe("checkUpdate", () => {
    it("returns non-available response when no update is found", async () => {
      (dbEngine.prisma.internalLicense.findUnique as jest.Mock).mockResolvedValue({
        id: "lic-1",
        entitlementId: "ent-1",
        status: "ACTIVE",
        activations: [{ id: "act-1", normalizedDomain: "example.com", status: "ACTIVE" }],
      });

      (dbEngine.issueUpdaterDownloadGrant as jest.Mock).mockResolvedValue({
        valid: true,
        updateAvailable: false,
      });

      const res = await service.checkUpdate({
        licenseKey: "NXS-1111-2222-3333-4444-5555-6666-7777-8888",
        domain: "example.com",
        productId: "p-1",
        currentVersion: "1.0.0",
      });

      expect(res.valid).toBe(true);
      expect(res.updateAvailable).toBe(false);
      expect(mockStorageService.createSignedDownloadUrl).not.toHaveBeenCalled();
      expect(dbEngine.recordDownloadIssuance).not.toHaveBeenCalled();
    });

    it("returns update payload with signed URL when update is eligible and primary file selected", async () => {
      (dbEngine.prisma.internalLicense.findUnique as jest.Mock).mockResolvedValue({
        id: "lic-1",
        entitlementId: "ent-1",
        status: "ACTIVE",
        activations: [{ id: "act-1", normalizedDomain: "example.com", status: "ACTIVE" }],
      });

      (dbEngine.issueUpdaterDownloadGrant as jest.Mock).mockResolvedValue({
        valid: true,
        updateAvailable: true,
        version: {
          id: "v-2",
          version: "2.0.0",
          releasedAt: new Date("2026-05-01"),
          releaseNotes: "Major upgrade",
        },
        file: {
          id: "f-2",
          storageKey: "products/p-1/versions/v-2/file.zip",
          fileName: "v2.zip",
          sizeBytes: 4096,
          sha256: "hash456",
          isPrimary: true,
        },
        grant: { id: "grant-u-1" },
      });

      mockStorageService.headObject.mockResolvedValue({ contentLength: 4096 });
      mockStorageService.createSignedDownloadUrl.mockResolvedValue(
        "https://r2.storage/signed-update-url",
      );

      const res = await service.checkUpdate({
        licenseKey: "NXS-1111-2222-3333-4444-5555-6666-7777-8888",
        domain: "example.com",
        productId: "p-1",
        currentVersion: "1.0.0",
      });

      expect(res.valid).toBe(true);
      expect(res.updateAvailable).toBe(true);
      expect(res.version).toBe("2.0.0");
      expect(res.downloadUrl).toBe("https://r2.storage/signed-update-url");
      expect(dbEngine.recordDownloadIssuance).toHaveBeenCalledWith({
        grantId: "grant-u-1",
        ipAddress: undefined,
        userAgent: undefined,
      });
    });

    it("rejects unactivated domain preflight before touching rate limiter", async () => {
      (dbEngine.prisma.internalLicense.findUnique as jest.Mock).mockResolvedValue({
        id: "lic-1",
        entitlementId: "ent-1",
        status: "ACTIVE",
        activations: [], // No active activation for this domain
      });

      const res = await service.checkUpdate({
        licenseKey: "NXS-1111-2222-3333-4444-5555-6666-7777-8888",
        domain: "unauthorized-domain.com",
        productId: "p-1",
        currentVersion: "1.0.0",
      });

      expect(res.valid).toBe(false);
      expect(res.updateAvailable).toBe(false);
      expect(mockRateLimiter.checkAndConsumeUpdaterRateLimit).not.toHaveBeenCalled();
    });
  });
});
