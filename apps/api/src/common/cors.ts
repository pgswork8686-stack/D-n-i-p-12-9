import { validateTrustedOrigin } from "@nexus/utils";

const DEV_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
];

const ORIGIN_KEYS = ["WEB_URL", "PORTAL_URL", "ADMIN_URL"] as const;

/**
 * Resolves the browser origins allowed to call the API with credentials.
 *
 * Production fails closed: every frontend origin must be configured, use
 * HTTPS, and must not target loopback. Localhost origins are never allowed
 * in production. Extra origins may be added via CORS_EXTRA_ORIGINS.
 */
export function resolveCorsOrigins(
  env: Record<string, string | undefined>,
): string[] {
  const isProduction = env.NODE_ENV === "production";
  const origins = new Set<string>();

  for (const key of ORIGIN_KEYS) {
    const raw = env[key]?.trim();
    if (!raw) {
      if (isProduction) {
        throw new Error(`${key} is required in production for CORS`);
      }
      continue;
    }
    origins.add(validateTrustedOrigin(raw, key, isProduction));
  }

  for (const extra of (env.CORS_EXTRA_ORIGINS || "").split(",")) {
    const raw = extra.trim();
    if (raw) origins.add(validateTrustedOrigin(raw, "CORS_EXTRA_ORIGINS", isProduction));
  }

  if (!isProduction) {
    for (const dev of DEV_ORIGINS) origins.add(dev);
  }

  return Array.from(origins);
}
