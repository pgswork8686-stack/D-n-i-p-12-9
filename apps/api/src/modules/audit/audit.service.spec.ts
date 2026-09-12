import { AuditService, sanitizeAuditErrorMessage } from "./audit.service";
import { prisma } from "@nexus/database";

describe("AuditService & Error Sanitization", () => {
  let service: AuditService;

  beforeEach(() => {
    service = new AuditService();
    jest.clearAllMocks();
  });

  describe("sanitizeAuditErrorMessage", () => {
    it("redacts postgres connection strings", () => {
      const err = new Error(
        "Connection failed to postgresql://postgres:mySecretPass123@db.prod.internal:5432/marketplace",
      );
      const sanitized = sanitizeAuditErrorMessage(err);
      expect(sanitized).not.toContain("mySecretPass123");
      expect(sanitized).toContain("postgresql://[REDACTED_URI]");
    });

    it("redacts password parameters", () => {
      const err = new Error("Auth failed with password=superSecretPassword and user=admin");
      const sanitized = sanitizeAuditErrorMessage(err);
      expect(sanitized).not.toContain("superSecretPassword");
      expect(sanitized).toContain("password=[REDACTED]");
    });

    it("redacts token and secret parameters", () => {
      const err = new Error("Invalid token=eyJhbGciOi... and secret=xyz987");
      const sanitized = sanitizeAuditErrorMessage(err);
      expect(sanitized).not.toContain("eyJhbGciOi");
      expect(sanitized).not.toContain("xyz987");
      expect(sanitized).toContain("token=[REDACTED]");
      expect(sanitized).toContain("secret=[REDACTED]");
    });

    it("returns safe generic code for Prisma errors", () => {
      const prismaErr = { code: "P2002", message: "Unique constraint failed on field (email)" };
      const sanitized = sanitizeAuditErrorMessage(prismaErr);
      expect(sanitized).toBe("Database operation failed [code: P2002]");
      expect(sanitized).not.toContain("field (email)");
    });
  });

  describe("logAction", () => {
    it("creates audit log and sanitizes sensitive detail properties", async () => {
      const createSpy = jest.spyOn(prisma.auditLog, "create").mockResolvedValue({} as any);

      await service.logAction({
        action: "TEST_ACTION",
        entity: "User",
        entityId: "u123",
        actorId: "actor123",
        details: {
          password: "plainPassword!",
          accessToken: "jwt.token.here",
          normalField: "public-value",
        },
      });

      expect(createSpy).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "TEST_ACTION",
          entity: "User",
          details: {
            password: "[REDACTED]",
            accessToken: "[REDACTED]",
            normalField: "public-value",
          },
        }),
      });
    });

    it("catches errors and logs sanitized message without throwing", async () => {
      jest.spyOn(prisma.auditLog, "create").mockRejectedValue(
        new Error("Connection error to postgresql://postgres:pass@host:5432/db"),
      );

      // Should not throw
      await expect(
        service.logAction({
          action: "FAIL_ACTION",
          entity: "User",
        }),
      ).resolves.not.toThrow();
    });
  });
});
