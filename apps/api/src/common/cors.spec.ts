import { ConfigService } from "@nestjs/config";
import { resolveCorsOrigins } from "@nexus/utils";

describe("API CORS Configuration & Fail-Closed Guard", () => {
  function getOriginsFromConfig(
    configService: ConfigService,
    isProduction: boolean,
  ): string[] {
    return resolveCorsOrigins(
      {
        webUrl: configService.get<string>("WEB_URL"),
        portalUrl: configService.get<string>("PORTAL_URL"),
        adminUrl: configService.get<string>("ADMIN_URL"),
      },
      { isProduction },
    );
  }

  describe("production environment (NODE_ENV === 'production')", () => {
    it("fails closed when WEB_URL is missing", () => {
      const configService = new ConfigService({
        PORTAL_URL: "https://portal.nexustheme.dev",
        ADMIN_URL: "https://admin.nexustheme.dev",
      });
      expect(() => getOriginsFromConfig(configService, true)).toThrow(
        /Production requires configured URLs for CORS: missing \[WEB_URL\]/,
      );
    });

    it("fails closed when PORTAL_URL is missing", () => {
      const configService = new ConfigService({
        WEB_URL: "https://nexustheme.dev",
        ADMIN_URL: "https://admin.nexustheme.dev",
      });
      expect(() => getOriginsFromConfig(configService, true)).toThrow(
        /Production requires configured URLs for CORS: missing \[PORTAL_URL\]/,
      );
    });

    it("fails closed when ADMIN_URL is missing", () => {
      const configService = new ConfigService({
        WEB_URL: "https://nexustheme.dev",
        PORTAL_URL: "https://portal.nexustheme.dev",
      });
      expect(() => getOriginsFromConfig(configService, true)).toThrow(
        /Production requires configured URLs for CORS: missing \[ADMIN_URL\]/,
      );
    });

    it("fails closed when all CORS URLs are missing", () => {
      const configService = new ConfigService({});
      expect(() => getOriginsFromConfig(configService, true)).toThrow(
        /missing \[WEB_URL, PORTAL_URL, ADMIN_URL\]/,
      );
    });

    it("fails closed when localhost leaks into production allowlist", () => {
      const configService = new ConfigService({
        WEB_URL: "https://localhost:3000",
        PORTAL_URL: "https://portal.nexustheme.dev",
        ADMIN_URL: "https://admin.nexustheme.dev",
      });
      expect(() => getOriginsFromConfig(configService, true)).toThrow(
        /cannot target localhost\/loopback address/,
      );
    });

    it("fails closed when 127.0.0.1 leaks into production allowlist", () => {
      const configService = new ConfigService({
        WEB_URL: "https://nexustheme.dev",
        PORTAL_URL: "https://127.0.0.1:3001",
        ADMIN_URL: "https://admin.nexustheme.dev",
      });
      expect(() => getOriginsFromConfig(configService, true)).toThrow(
        /cannot target localhost\/loopback address/,
      );
    });

    it("fails closed when URL is non-HTTPS in production", () => {
      const configService = new ConfigService({
        WEB_URL: "http://nexustheme.dev",
        PORTAL_URL: "https://portal.nexustheme.dev",
        ADMIN_URL: "https://admin.nexustheme.dev",
      });
      expect(() => getOriginsFromConfig(configService, true)).toThrow(
        /must use HTTPS/,
      );
    });

    it("succeeds with strictly the 3 configured HTTPS origins and zero localhost origins", () => {
      const configService = new ConfigService({
        WEB_URL: "https://nexustheme.dev",
        PORTAL_URL: "https://portal.nexustheme.dev",
        ADMIN_URL: "https://admin.nexustheme.dev",
      });
      const origins = getOriginsFromConfig(configService, true);
      expect(origins).toEqual([
        "https://nexustheme.dev",
        "https://portal.nexustheme.dev",
        "https://admin.nexustheme.dev",
      ]);
      expect(origins).not.toContain("http://localhost:3000");
      expect(origins).not.toContain("http://localhost:3001");
      expect(origins).not.toContain("http://localhost:3002");
    });
  });

  describe("non-production environment (development / test)", () => {
    it("falls back to localhost defaults when variables are absent", () => {
      const configService = new ConfigService({});
      const origins = getOriginsFromConfig(configService, false);
      expect(origins).toContain("http://localhost:3000");
      expect(origins).toContain("http://localhost:3001");
      expect(origins).toContain("http://localhost:3002");
    });

    it("preserves custom dev URLs alongside standard localhost origins", () => {
      const configService = new ConfigService({
        WEB_URL: "http://dev.mytheme.local:3000",
        PORTAL_URL: "http://dev.mytheme.local:3001",
        ADMIN_URL: "http://dev.mytheme.local:3002",
      });
      const origins = getOriginsFromConfig(configService, false);
      expect(origins).toContain("http://dev.mytheme.local:3000");
      expect(origins).toContain("http://dev.mytheme.local:3001");
      expect(origins).toContain("http://dev.mytheme.local:3002");
      expect(origins).toContain("http://localhost:3000");
      expect(origins).toContain("http://localhost:3001");
      expect(origins).toContain("http://localhost:3002");
    });
  });
});
