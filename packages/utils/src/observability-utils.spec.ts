import {
  redactSensitiveFields,
  getMemoryUsageStats,
  getDefaultSecurityHeaders,
  formatStructuredLog,
} from "./observability-utils";
import { computeSha256 } from "./hmac-signature";

describe("Observability & Hardening Utils", () => {
  describe("redactSensitiveFields", () => {
    it("redacts sensitive fields like passwords, tokens, and credit cards", () => {
      const payload = {
        username: "admin_user",
        password: "SuperSecretPassword123!",
        stripeSecretKey: "sk_live_abcdef123456",
        cardNumber: "4242424242424242",
        cvv: "123",
        nested: {
          authToken: "bearer_xyz987",
          publicInfo: "hello world",
          user: {
            authEncryptedToken: "enc_data",
            email: "user@example.com",
          },
        },
      };

      const redacted = redactSensitiveFields(payload);

      expect(redacted.username).toBe("admin_user");
      expect(redacted.password).toBe("[REDACTED]");
      expect(redacted.stripeSecretKey).toBe("[REDACTED]");
      expect(redacted.cardNumber).toBe("[REDACTED]");
      expect(redacted.cvv).toBe("[REDACTED]");
      expect(redacted.nested.authToken).toBe("[REDACTED]");
      expect(redacted.nested.publicInfo).toBe("hello world");
      expect(redacted.nested.user.authEncryptedToken).toBe("[REDACTED]");
      expect(redacted.nested.user.email).toBe("user@example.com");
    });

    it("handles primitives and null values safely", () => {
      expect(redactSensitiveFields(null)).toBeNull();
      expect(redactSensitiveFields(undefined)).toBeUndefined();
      expect(redactSensitiveFields("string")).toBe("string");
      expect(redactSensitiveFields(123)).toBe(123);
    });

    it("redacts inside arrays", () => {
      const arrayData = [
        { apiKey: "key-1", name: "Service A" },
        { apiKey: "key-2", name: "Service B" },
      ];

      const redacted = redactSensitiveFields(arrayData);
      expect(redacted[0].apiKey).toBe("[REDACTED]");
      expect(redacted[0].name).toBe("Service A");
      expect(redacted[1].apiKey).toBe("[REDACTED]");
      expect(redacted[1].name).toBe("Service B");
    });
  });

  describe("getMemoryUsageStats", () => {
    it("returns positive memory numbers in megabytes", () => {
      const stats = getMemoryUsageStats();
      expect(stats.rssMb).toBeGreaterThan(0);
      expect(stats.heapTotalMb).toBeGreaterThan(0);
      expect(stats.heapUsedMb).toBeGreaterThan(0);
      expect(stats.externalMb).toBeGreaterThanOrEqual(0);
    });
  });

  describe("computeSha256", () => {
    it("computes deterministic SHA256 checksum", () => {
      const hash1 = computeSha256("test-database-dump-content");
      const hash2 = computeSha256("test-database-dump-content");
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });
  });

  describe("getDefaultSecurityHeaders", () => {
    it("returns standard OWASP headers", () => {
      const headers = getDefaultSecurityHeaders();
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["X-Frame-Options"]).toBe("DENY");
      expect(headers["Strict-Transport-Security"]).toContain("max-age=31536000");
      expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    });
  });

  describe("formatStructuredLog", () => {
    it("formats entry into JSON string and redacts details", () => {
      const entry = {
        timestamp: "2026-09-24T12:00:00.000Z",
        level: "info" as const,
        correlationId: "req_test123",
        service: "api",
        method: "POST",
        path: "/v1/auth/login",
        statusCode: 200,
        durationMs: 45,
        message: "User logged in",
        details: {
          userEmail: "admin@domain.com",
          userPassword: "PlaintextPasswordHere",
        },
      };

      const formatted = formatStructuredLog(entry);
      const parsed = JSON.parse(formatted);

      expect(parsed.correlationId).toBe("req_test123");
      expect(parsed.details.userEmail).toBe("admin@domain.com");
      expect(parsed.details.userPassword).toBe("[REDACTED]");
    });
  });
});
