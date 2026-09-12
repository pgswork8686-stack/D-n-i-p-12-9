import { DevMockAuthProvider } from "./dev-provider";

describe("DevMockAuthProvider", () => {
  const provider = new DevMockAuthProvider();

  it("verifies valid dev admin token", async () => {
    const user = await provider.verifyToken("dev-admin-token");
    expect(user).not.toBeNull();
    expect(user?.role).toBe("ADMIN");
  });

  it("verifies valid dev user token", async () => {
    const user = await provider.verifyToken("dev-user-token");
    expect(user).not.toBeNull();
    expect(user?.role).toBe("USER");
  });

  it("returns null for invalid token", async () => {
    const user = await provider.verifyToken("invalid-token");
    expect(user).toBeNull();
  });
});
