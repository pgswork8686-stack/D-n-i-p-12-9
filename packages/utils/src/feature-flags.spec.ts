import { resolveFeatureFlags, isFeatureEnabled } from "./feature-flags";

describe("feature flags", () => {
  it("defaults every module OFF in production", () => {
    expect(resolveFeatureFlags({ NODE_ENV: "production" })).toEqual({
      hosting: false,
      membership: false,
      affiliate: false,
      finance: false,
    });
  });

  it("defaults every module ON outside production", () => {
    expect(resolveFeatureFlags({ NODE_ENV: "test" })).toEqual({
      hosting: true,
      membership: true,
      affiliate: true,
      finance: true,
    });
  });

  it("honours explicit overrides", () => {
    const env = {
      NODE_ENV: "production",
      FEATURE_AFFILIATE: "true",
      FEATURE_HOSTING: "off",
    };
    expect(isFeatureEnabled("affiliate", env)).toBe(true);
    expect(isFeatureEnabled("hosting", env)).toBe(false);
    expect(isFeatureEnabled("hosting", { NODE_ENV: "test", FEATURE_HOSTING: "0" })).toBe(false);
  });

  it("ignores unparseable values and keeps the default", () => {
    expect(isFeatureEnabled("finance", { NODE_ENV: "production", FEATURE_FINANCE: "maybe" })).toBe(false);
  });
});
