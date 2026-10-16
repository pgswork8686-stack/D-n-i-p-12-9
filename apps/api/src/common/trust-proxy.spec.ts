import { DEFAULT_TRUST_PROXY_HOPS, resolveTrustProxyHops } from "./trust-proxy";

describe("resolveTrustProxyHops", () => {
  it("keeps the historical single hop when unset, and reports it as defaulted", () => {
    expect(resolveTrustProxyHops({})).toEqual({ hops: DEFAULT_TRUST_PROXY_HOPS, explicit: false });
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: "  " })).toEqual({ hops: 1, explicit: false });
  });

  it("accepts explicit hop counts", () => {
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: "2" })).toEqual({ hops: 2, explicit: true });
    expect(resolveTrustProxyHops({ TRUST_PROXY_HOPS: "0", NODE_ENV: "development" })).toEqual({ hops: 0, explicit: true });
  });

  it.each(["-1", "1.5", "two", "1e1", "6", "99"])("rejects %s", (bad) => {
    expect(() => resolveTrustProxyHops({ TRUST_PROXY_HOPS: bad })).toThrow(/TRUST_PROXY_HOPS/);
  });

  it("forbids 0 hops in production", () => {
    expect(() => resolveTrustProxyHops({ TRUST_PROXY_HOPS: "0", NODE_ENV: "production" })).toThrow(/not allowed in production/);
  });
});
