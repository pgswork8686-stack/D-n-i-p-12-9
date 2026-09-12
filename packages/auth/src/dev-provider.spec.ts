import { DevMockAuthProvider } from "./dev-provider";
import { ProductionFailClosedAuthProvider } from "./production-provider";

describe("DevMockAuthProvider", () => {
  const provider = new DevMockAuthProvider();

  it("verifies valid dev admin token", async () => {
    const identity = await provider.verifyToken("dev-admin-token");
    expect(identity).not.toBeNull();
    expect(identity?.subject).toBe("sub_dev_admin_001");
    expect(identity?.email).toBe("admin@nexustheme.dev");
  });

  it("verifies valid dev customer token", async () => {
    const identity = await provider.verifyToken("dev-customer-token");
    expect(identity).not.toBeNull();
    expect(identity?.subject).toBe("sub_dev_customer_001");
    expect(identity?.email).toBe("customer@nexustheme.dev");
  });

  it("verifies legacy dev user token alias", async () => {
    const identity = await provider.verifyToken("dev-user-token");
    expect(identity).not.toBeNull();
    expect(identity?.subject).toBe("sub_dev_customer_001");
  });

  it("verifies valid dev superadmin token", async () => {
    const identity = await provider.verifyToken("dev-superadmin-token");
    expect(identity).not.toBeNull();
    expect(identity?.subject).toBe("sub_dev_superadmin_001");
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

