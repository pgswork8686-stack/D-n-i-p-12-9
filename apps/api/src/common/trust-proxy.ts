/**
 * How many reverse-proxy hops sit in front of the API.
 *
 * Express derives `req.ip` from X-Forwarded-For by skipping this many trusted hops from the
 * socket. A wrong number is a security problem, not a cosmetic one:
 *  - too low  → `req.ip` becomes a proxy address, so every visitor shares one rate-limit bucket;
 *  - too high → the client controls `req.ip` by sending its own X-Forwarded-For, which defeats
 *    every per-IP limit (public inquiry form, login throttling, download limits).
 *
 * Topologies (see docs/deployment/proxy-topology.md):
 *  - Caddy only (Cloudflare "DNS only" / grey cloud)        → 1
 *  - Cloudflare proxied (orange cloud) → Caddy → API        → 2
 *  - API reachable directly with no proxy (local dev)       → 0
 */
export const DEFAULT_TRUST_PROXY_HOPS = 1;
export const MAX_TRUST_PROXY_HOPS = 5;

export interface TrustProxyResolution {
  hops: number;
  /** True when TRUST_PROXY_HOPS was set explicitly rather than defaulted. */
  explicit: boolean;
}

export function resolveTrustProxyHops(env: Record<string, string | undefined>): TrustProxyResolution {
  const raw = env.TRUST_PROXY_HOPS?.trim();
  if (raw === undefined || raw === "") {
    return { hops: DEFAULT_TRUST_PROXY_HOPS, explicit: false };
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(`TRUST_PROXY_HOPS must be a whole number between 0 and ${MAX_TRUST_PROXY_HOPS}, got "${raw}"`);
  }
  const hops = Number(raw);
  if (hops > MAX_TRUST_PROXY_HOPS) {
    throw new Error(`TRUST_PROXY_HOPS must be between 0 and ${MAX_TRUST_PROXY_HOPS}, got ${hops}`);
  }
  if (hops === 0 && env.NODE_ENV === "production") {
    // Production traffic always arrives through Caddy; 0 would make req.ip the proxy for everyone.
    throw new Error("TRUST_PROXY_HOPS=0 is not allowed in production: Caddy always sits in front of the API");
  }
  return { hops, explicit: true };
}
