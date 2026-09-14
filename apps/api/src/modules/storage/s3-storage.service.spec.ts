import { ConfigService } from "@nestjs/config";
import { S3CompatibleStorageService } from "./s3-storage.service";
import { resolveDownloadTtl } from "@nexus/contracts";

describe("S3CompatibleStorageService", () => {
  describe("Production configuration fail-closed", () => {
    it("fails closed on startup if NODE_ENV=production and required env vars are missing", () => {
      const mockConfigService = {
        get: jest.fn((key: string) => {
          if (key === "NODE_ENV") return "production";
          if (key === "STORAGE_PROVIDER") return "r2";
          if (key === "STORAGE_ENDPOINT") return "https://r2.cloudflarestorage.com";
          if (key === "STORAGE_BUCKET") return "my-bucket";
          // Missing access key and secret key
          return undefined;
        }),
      } as unknown as ConfigService;

      expect(() => new S3CompatibleStorageService(mockConfigService)).toThrow(
        /Production configuration missing required environment variable: STORAGE_ACCESS_KEY/,
      );
    });

    it("succeeds startup if NODE_ENV=production and all required env vars are set", () => {
      const mockConfigService = {
        get: jest.fn((key: string) => {
          if (key === "NODE_ENV") return "production";
          if (key === "STORAGE_PROVIDER") return "r2";
          if (key === "STORAGE_ENDPOINT") return "https://r2.cloudflarestorage.com";
          if (key === "STORAGE_BUCKET") return "prod-bucket";
          if (key === "STORAGE_ACCESS_KEY") return "prod-access-key";
          if (key === "STORAGE_SECRET_KEY") return "prod-secret-key";
          if (key === "STORAGE_REGION") return "auto";
          return undefined;
        }),
      } as unknown as ConfigService;

      expect(() => new S3CompatibleStorageService(mockConfigService)).not.toThrow();
    });

    it("allows local dev defaults when NODE_ENV=development", () => {
      const mockConfigService = {
        get: jest.fn((key: string) => {
          if (key === "NODE_ENV") return "development";
          return undefined;
        }),
      } as unknown as ConfigService;

      expect(() => new S3CompatibleStorageService(mockConfigService)).not.toThrow();
    });
  });

  describe("resolveDownloadTtl", () => {
    it("clamps TTL below 120 to 120", () => {
      expect(resolveDownloadTtl(60)).toBe(120);
      expect(resolveDownloadTtl(0)).toBe(120);
      expect(resolveDownloadTtl(-10)).toBe(120);
    });

    it("keeps TTL in range 120..300 intact", () => {
      expect(resolveDownloadTtl(180)).toBe(180);
      expect(resolveDownloadTtl(240)).toBe(240);
    });

    it("clamps TTL above 300 to 300", () => {
      expect(resolveDownloadTtl(600)).toBe(300);
      expect(resolveDownloadTtl(1000)).toBe(300);
    });

    it("handles strings, null, undefined, and NaN safely with default 180", () => {
      expect(resolveDownloadTtl("180")).toBe(180);
      expect(resolveDownloadTtl("600")).toBe(300);
      expect(resolveDownloadTtl(null)).toBe(180);
      expect(resolveDownloadTtl(undefined)).toBe(180);
      expect(resolveDownloadTtl("invalid")).toBe(180);
    });
  });
});
