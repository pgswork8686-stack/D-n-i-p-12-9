import { resolvePublicSiteUrl, resolveApiUrl, resolveCorsOrigins } from "./url-validator";

describe("Authoritative URL Origin Resolvers", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("resolvePublicSiteUrl", () => {
    it("development: missing SITE_URL -> defaults to http://localhost:3000", () => {
      delete process.env.NEXT_PUBLIC_SITE_URL;
      delete process.env.SITE_URL;
      delete process.env.WEB_URL;
      const url = resolvePublicSiteUrl(undefined, { isProduction: false });
      expect(url).toBe("http://localhost:3000");
    });

    it("development: valid http localhost accepted", () => {
      const url = resolvePublicSiteUrl("http://localhost:3000", { isProduction: false });
      expect(url).toBe("http://localhost:3000");
    });

    it("development: valid https URL accepted", () => {
      const url = resolvePublicSiteUrl("https://example.dev", { isProduction: false });
      expect(url).toBe("https://example.dev");
    });

    it("production: missing SITE_URL -> throws fail-closed error", () => {
      delete process.env.NEXT_PUBLIC_SITE_URL;
      delete process.env.SITE_URL;
      delete process.env.WEB_URL;
      expect(() => resolvePublicSiteUrl(undefined, { isProduction: true })).toThrow(
        /Production requires a configured public site URL/,
      );
    });

    it("production: http://example.com -> rejected (must use HTTPS)", () => {
      expect(() => resolvePublicSiteUrl("http://example.com", { isProduction: true })).toThrow(
        /must use HTTPS/,
      );
    });

    it("production: https://example.com -> accepted and normalized", () => {
      const url = resolvePublicSiteUrl("https://example.com/extra/path", { isProduction: true });
      expect(url).toBe("https://example.com");
    });

    it("production: http://localhost:3000 -> rejected", () => {
      expect(() => resolvePublicSiteUrl("http://localhost:3000", { isProduction: true })).toThrow(
        /must use HTTPS/,
      );
    });

    it("production: https://localhost -> rejected (loopback forbidden)", () => {
      expect(() => resolvePublicSiteUrl("https://localhost", { isProduction: true })).toThrow(
        /cannot target localhost\/loopback address/,
      );
    });

    it("production: https://127.0.0.1:3000 -> rejected (loopback forbidden)", () => {
      expect(() => resolvePublicSiteUrl("https://127.0.0.1:3000", { isProduction: true })).toThrow(
        /cannot target localhost\/loopback address/,
      );
    });

    it("production: https://[::1]:3000 -> rejected (loopback forbidden)", () => {
      expect(() => resolvePublicSiteUrl("https://[::1]:3000", { isProduction: true })).toThrow(
        /cannot target localhost\/loopback address/,
      );
    });

    it("production: javascript:alert(1) -> rejected (unsafe scheme)", () => {
      expect(() => resolvePublicSiteUrl("javascript:alert(1)", { isProduction: true })).toThrow(
        /Unsupported protocol/,
      );
    });

    it("production: malformed string -> rejected", () => {
      expect(() => resolvePublicSiteUrl("not-a-valid-url", { isProduction: true })).toThrow(
        /Invalid Site URL format/,
      );
    });

    it("rejects protocol-relative // URLs", () => {
      expect(() => resolvePublicSiteUrl("//example.com", { isProduction: true })).toThrow(
        /cannot be protocol-relative/,
      );
    });

    it("rejects credentials in URL", () => {
      expect(() =>
        resolvePublicSiteUrl("https://user:pass@example.com", { isProduction: true }),
      ).toThrow(/cannot contain embedded credentials/);
    });
  });

  describe("resolveApiUrl", () => {
    it("development: missing API_URL -> defaults to http://localhost:4000", () => {
      delete process.env.NEXT_PUBLIC_API_URL;
      delete process.env.API_URL;
      const url = resolveApiUrl(undefined, { isProduction: false });
      expect(url).toBe("http://localhost:4000");
    });

    it("development: valid http localhost accepted", () => {
      const url = resolveApiUrl("http://localhost:4000", { isProduction: false });
      expect(url).toBe("http://localhost:4000");
    });

    it("production: missing API_URL -> throws fail-closed error", () => {
      delete process.env.NEXT_PUBLIC_API_URL;
      delete process.env.API_URL;
      expect(() => resolveApiUrl(undefined, { isProduction: true })).toThrow(
        /Production requires a configured API URL/,
      );
    });

    it("production: http://api.domain.com -> rejected (must use HTTPS)", () => {
      expect(() => resolveApiUrl("http://api.domain.com", { isProduction: true })).toThrow(
        /must use HTTPS/,
      );
    });

    it("production: https://api.domain.com -> accepted and normalized", () => {
      const url = resolveApiUrl("https://api.domain.com/v1", { isProduction: true });
      expect(url).toBe("https://api.domain.com");
    });

    it("production: http://localhost:4000 -> rejected", () => {
      expect(() => resolveApiUrl("http://localhost:4000", { isProduction: true })).toThrow(
        /must use HTTPS/,
      );
    });

    it("production: https://localhost -> rejected", () => {
      expect(() => resolveApiUrl("https://localhost", { isProduction: true })).toThrow(
        /cannot target localhost\/loopback address/,
      );
    });

    it("production: javascript:void(0) -> rejected", () => {
      expect(() => resolveApiUrl("javascript:void(0)", { isProduction: true })).toThrow(
        /Unsupported protocol/,
      );
    });

    it("production: malformed string -> rejected", () => {
      expect(() => resolveApiUrl("bad-api-url", { isProduction: true })).toThrow(
        /Invalid API URL format/,
      );
    });
  });

  describe("resolveCorsOrigins", () => {
    it("production: missing WEB_URL -> throws fail-closed error", () => {
      expect(() =>
        resolveCorsOrigins(
          { portalUrl: "https://portal.example.com", adminUrl: "https://admin.example.com" },
          { isProduction: true },
        ),
      ).toThrow(/Production requires configured URLs for CORS: missing \[WEB_URL\]/);
    });

    it("production: missing PORTAL_URL -> throws fail-closed error", () => {
      expect(() =>
        resolveCorsOrigins(
          { webUrl: "https://example.com", adminUrl: "https://admin.example.com" },
          { isProduction: true },
        ),
      ).toThrow(/Production requires configured URLs for CORS: missing \[PORTAL_URL\]/);
    });

    it("production: missing ADMIN_URL -> throws fail-closed error", () => {
      expect(() =>
        resolveCorsOrigins(
          { webUrl: "https://example.com", portalUrl: "https://portal.example.com" },
          { isProduction: true },
        ),
      ).toThrow(/Production requires configured URLs for CORS: missing \[ADMIN_URL\]/);
    });

    it("production: missing all URLs -> throws reporting all missing variables", () => {
      expect(() => resolveCorsOrigins({}, { isProduction: true })).toThrow(
        /missing \[WEB_URL, PORTAL_URL, ADMIN_URL\]/,
      );
    });

    it("production: non-HTTPS WEB_URL -> throws fail-closed error", () => {
      expect(() =>
        resolveCorsOrigins(
          {
            webUrl: "http://example.com",
            portalUrl: "https://portal.example.com",
            adminUrl: "https://admin.example.com",
          },
          { isProduction: true },
        ),
      ).toThrow(/Production WEB_URL must use HTTPS/);
    });

    it("production: localhost in allowlist -> throws fail-closed error", () => {
      expect(() =>
        resolveCorsOrigins(
          {
            webUrl: "https://localhost:3000",
            portalUrl: "https://portal.example.com",
            adminUrl: "https://admin.example.com",
          },
          { isProduction: true },
        ),
      ).toThrow(/Production WEB_URL cannot target localhost\/loopback address/);
    });

    it("production: 127.0.0.1 in allowlist -> throws fail-closed error", () => {
      expect(() =>
        resolveCorsOrigins(
          {
            webUrl: "https://example.com",
            portalUrl: "https://127.0.0.1:3001",
            adminUrl: "https://admin.example.com",
          },
          { isProduction: true },
        ),
      ).toThrow(/Production PORTAL_URL cannot target localhost\/loopback address/);
    });

    it("production: ::1 loopback in allowlist -> throws fail-closed error", () => {
      expect(() =>
        resolveCorsOrigins(
          {
            webUrl: "https://example.com",
            portalUrl: "https://portal.example.com",
            adminUrl: "https://[::1]:3002",
          },
          { isProduction: true },
        ),
      ).toThrow(/Production ADMIN_URL cannot target localhost\/loopback address/);
    });

    it("production: URL with embedded credentials -> throws fail-closed error", () => {
      expect(() =>
        resolveCorsOrigins(
          {
            webUrl: "https://user:pass@example.com",
            portalUrl: "https://portal.example.com",
            adminUrl: "https://admin.example.com",
          },
          { isProduction: true },
        ),
      ).toThrow(/WEB_URL cannot contain embedded credentials/);
    });

    it("production: valid HTTPS origins -> returns strictly the 3 origins without localhost", () => {
      const origins = resolveCorsOrigins(
        {
          webUrl: "https://nexustheme.dev/path?query=1",
          portalUrl: "https://portal.nexustheme.dev/",
          adminUrl: "https://admin.nexustheme.dev",
        },
        { isProduction: true },
      );

      expect(origins).toEqual([
        "https://nexustheme.dev",
        "https://portal.nexustheme.dev",
        "https://admin.nexustheme.dev",
      ]);
      expect(origins.some((o) => o.includes("localhost"))).toBe(false);
      expect(origins.some((o) => o.includes("127.0.0.1"))).toBe(false);
    });

    it("non-production: missing URLs -> defaults to localhost ports and includes localhost allowlist", () => {
      const origins = resolveCorsOrigins({}, { isProduction: false });

      expect(origins).toContain("http://localhost:3000");
      expect(origins).toContain("http://localhost:3001");
      expect(origins).toContain("http://localhost:3002");
    });

    it("non-production: custom dev URLs -> includes both custom origins and localhost defaults", () => {
      const origins = resolveCorsOrigins(
        {
          webUrl: "http://mydev.local:3000",
          portalUrl: "http://mydev.local:3001",
          adminUrl: "http://mydev.local:3002",
        },
        { isProduction: false },
      );

      expect(origins).toContain("http://mydev.local:3000");
      expect(origins).toContain("http://mydev.local:3001");
      expect(origins).toContain("http://mydev.local:3002");
      expect(origins).toContain("http://localhost:3000");
      expect(origins).toContain("http://localhost:3001");
      expect(origins).toContain("http://localhost:3002");
    });
  });
});
