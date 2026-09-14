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
    createProductVersion: jest.fn(),
    listProductVersions: jest.fn(),
    getProductVersionById: jest.fn(),
    addVersionFile: jest.fn(),
    publishProductVersion: jest.fn(),
    authorizeCustomerDownload: jest.fn(),
    authorizeLicenseUpdater: jest.fn(),
    recordDownloadEvent: jest.fn(),
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
    };

    mockRateLimiter = {
      checkAndConsumeRateLimit: jest.fn().mockResolvedValue(undefined),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue("180"),
    };

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

  describe("addFile", () => {
    it("verifies object in storage and registers verified file", async () => {
      (dbEngine.getProductVersionById as jest.Mock).mockResolvedValue({
        id: "v-1",
        productId: "p-1",
        status: "DRAFT",
      });

      mockStorageService.headObject.mockResolvedValue({
        contentLength: 1024,
        contentType: "application/zip",
      });

      mockStorageService.verifyObjectIntegrity.mockResolvedValue({
        valid: true,
        actualSha256: "abc123sha",
        actualSizeBytes: 1024,
      });

      (dbEngine.addVersionFile as jest.Mock).mockResolvedValue({
        id: "f-1",
        productVersionId: "v-1",
        storageKey: "storage/key.zip",
        fileName: "theme.zip",
        sizeBytes: 1024,
        sha256: "abc123sha",
      });

      const res = await service.addFile(
        "v-1",
        {
          fileName: "theme.zip",
          storageKey: "storage/key.zip",
        },
        "admin-1",
      );

      expect(res.id).toBe("f-1");
      expect(mockStorageService.headObject).toHaveBeenCalledWith("storage/key.zip");
      expect(mockStorageService.verifyObjectIntegrity).toHaveBeenCalledWith(
        "storage/key.zip",
        undefined,
        undefined,
      );
    });

    it("throws 400 if object is not in storage", async () => {
      (dbEngine.getProductVersionById as jest.Mock).mockResolvedValue({
        id: "v-1",
        productId: "p-1",
      });
      mockStorageService.headObject.mockResolvedValue(null);

      await expect(
        service.addFile(
          "v-1",
          { fileName: "theme.zip", storageKey: "missing.zip" },
          "admin-1",
        ),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("publishVersion", () => {
    it("calls publishProductVersion domain function", async () => {
      (dbEngine.publishProductVersion as jest.Mock).mockResolvedValue({
        success: true,
        version: { id: "v-1", status: "PUBLISHED" },
      });

      const res = await service.publishVersion("v-1", "admin-1");
      expect(res.success).toBe(true);
      expect(dbEngine.publishProductVersion).toHaveBeenCalledWith({
        productVersionId: "v-1",
        actorId: "admin-1",
      });
    });
  });

  describe("requestDownload", () => {
    it("enforces rate limit, checks authorization, creates signed URL and records event", async () => {
      (dbEngine.authorizeCustomerDownload as jest.Mock).mockResolvedValue({
        entitlement: { id: "ent-1", userId: "u-1" },
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

      expect(mockRateLimiter.checkAndConsumeRateLimit).toHaveBeenCalledWith(
        "u-1",
        "ent-1",
      );
      expect(dbEngine.authorizeCustomerDownload).toHaveBeenCalledWith({
        userId: "u-1",
        entitlementId: "ent-1",
        versionId: "v-1",
        fileId: "f-1",
      });
      expect(mockStorageService.createSignedDownloadUrl).toHaveBeenCalledWith(
        "products/p-1/versions/v-1/file.zip",
        { filename: "file.zip", ttlSeconds: 180 },
      );
      expect(dbEngine.recordDownloadEvent).toHaveBeenCalledWith({
        userId: "u-1",
        entitlementId: "ent-1",
        productId: "p-1",
        productVersionId: "v-1",
        fileId: "f-1",
        channel: "CUSTOMER_PORTAL",
        ipAddress: "127.0.0.1",
        userAgent: "Mozilla/5.0",
      });
      expect(res.downloadUrl).toBe("https://r2.storage/signed-url");
      expect(res.expiresIn).toBe(180);
    });
  });

  describe("checkUpdate", () => {
    it("returns non-available response when no update is found", async () => {
      (dbEngine.authorizeLicenseUpdater as jest.Mock).mockResolvedValue({
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
    });

    it("returns update payload with signed URL when update is eligible", async () => {
      (dbEngine.authorizeLicenseUpdater as jest.Mock).mockResolvedValue({
        valid: true,
        updateAvailable: true,
        eligibleVersion: {
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
        },
        entitlementId: "ent-1",
        userId: "u-1",
      });

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
      expect(dbEngine.recordDownloadEvent).toHaveBeenCalledWith({
        userId: "u-1",
        entitlementId: "ent-1",
        productId: "p-1",
        productVersionId: "v-2",
        fileId: "f-2",
        channel: "LICENSE_UPDATER",
        ipAddress: undefined,
        userAgent: undefined,
      });
    });
  });
});
