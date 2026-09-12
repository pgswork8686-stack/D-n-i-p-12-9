import { DevMockAuthProvider } from "./dev-provider";
import { ProductionFailClosedAuthProvider } from "./production-provider";

describe("DevMockAuthProvider", () => {
  const provider = new DevMockAuthProvider();

  it("verifies valid dev admin token with emailVerified true", async () => {
    const identity = await provider.verifyToken("dev-admin-token");
    expect(identity).not.toBeNull();
    expect(identity?.subject).toBe("sub_dev_admin_001");
    expect(identity?.email).toBe("admin@nexustheme.dev");
    expect(identity?.emailVerified).toBe(true);
  });

  it("verifies valid dev customer token with emailVerified true", async () => {
    const identity = await provider.verifyToken("dev-customer-token");
    expect(identity).not.toBeNull();
    expect(identity?.subject).toBe("sub_dev_customer_001");
    expect(identity?.email).toBe("customer@nexustheme.dev");
    expect(identity?.emailVerified).toBe(true);
  });

  it("verifies legacy dev user token alias", async () => {
    const identity = await provider.verifyToken("dev-user-token");
    expect(identity).not.toBeNull();
    expect(identity?.subject).toBe("sub_dev_customer_001");
    expect(identity?.emailVerified).toBe(true);
  });

  it("verifies valid dev superadmin token", async () => {
    const identity = await provider.verifyToken("dev-superadmin-token");
    expect(identity).not.toBeNull();
    expect(identity?.subject).toBe("sub_dev_superadmin_001");
    expect(identity?.emailVerified).toBe(true);
  });

  it("supports dev-no-email token returning email: null and emailVerified: false", async () => {
    const identity = await provider.verifyToken("dev-no-email:sub_no_mail_1");
    expect(identity).not.toBeNull();
    expect(identity?.subject).toBe("sub_no_mail_1");
    expect(identity?.email).toBeNull();
    expect(identity?.emailVerified).toBe(false);
  });

  it("supports dynamic dev-custom with unverified flag", async () => {
    const identity = await provider.verifyToken("dev-custom:sub_u1:test@dev.io:unverified");
    expect(identity).not.toBeNull();
    expect(identity?.subject).toBe("sub_u1");
    expect(identity?.email).toBe("test@dev.io");
    expect(identity?.emailVerified).toBe(false);
  });

  it("returns null for invalid token", async () => {
    const identity = await provider.verifyToken("invalid-token");
    expect(identity).toBeNull();
  });

  it("rejects dev tokens in production environment (fail-closed)", async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const identity = await provider.verifyToken("dev-admin-token");
      expect(identity).toBeNull();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("ProductionFailClosedAuthProvider always returns null", async () => {
    const prodProvider = new ProductionFailClosedAuthProvider();
    expect(await prodProvider.verifyToken("dev-admin-token")).toBeNull();
    expect(await prodProvider.verifyToken("any-token")).toBeNull();
  });
});
