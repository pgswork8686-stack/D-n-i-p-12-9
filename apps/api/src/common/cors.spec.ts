import { resolveCorsOrigins } from "./cors";

describe("resolveCorsOrigins", () => {
  const prodEnv = {
    NODE_ENV: "production",
    WEB_URL: "https://nexustheme.vn",
    PORTAL_URL: "https://app.nexustheme.vn",
    ADMIN_URL: "https://admin.nexustheme.vn/",
  };

  it("returns only configured HTTPS origins in production", () => {
    expect(resolveCorsOrigins(prodEnv)).toEqual([
      "https://nexustheme.vn",
      "https://app.nexustheme.vn",
      "https://admin.nexustheme.vn",
    ]);
  });

  it("never includes localhost in production", () => {
    const origins = resolveCorsOrigins(prodEnv);
    expect(origins.some((o) => o.includes("localhost"))).toBe(false);
  });

  it("fails closed when a production origin is missing", () => {
    expect(() =>
      resolveCorsOrigins({ ...prodEnv, ADMIN_URL: undefined }),
    ).toThrow(/ADMIN_URL is required/);
  });

  it("fails closed on http or loopback origins in production", () => {
    expect(() =>
      resolveCorsOrigins({ ...prodEnv, WEB_URL: "http://nexustheme.vn" }),
    ).toThrow(/HTTPS/);
    expect(() =>
      resolveCorsOrigins({ ...prodEnv, PORTAL_URL: "https://localhost:3001" }),
    ).toThrow(/loopback/);
  });

  it("rejects embedded credentials", () => {
    expect(() =>
      resolveCorsOrigins({ ...prodEnv, WEB_URL: "https://u:p@nexustheme.vn" }),
    ).toThrow(/credentials/);
  });

  it("adds localhost defaults outside production", () => {
    const origins = resolveCorsOrigins({ NODE_ENV: "development" });
    expect(origins).toEqual([
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
    ]);
  });

  it("accepts validated extra origins", () => {
    const origins = resolveCorsOrigins({
      ...prodEnv,
      CORS_EXTRA_ORIGINS: "https://www.nexustheme.vn, ",
    });
    expect(origins).toContain("https://www.nexustheme.vn");
  });
});
