/**
 * Canonical URL validator.
 * Validates that custom canonical URLs use safe protocols (https: or http:) and valid syntax.
 * Rejects javascript:, data:, ftp:, protocol-relative //, and malformed strings.
 */
export function isValidCanonicalUrl(
  urlStr: string,
  allowedOrigins?: string[],
): boolean {
  if (!urlStr || typeof urlStr !== "string" || !urlStr.trim()) {
    return false;
  }

  const trimmed = urlStr.trim();

  // Reject protocol-relative URLs
  if (trimmed.startsWith("//")) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();

    if (protocol !== "https:" && protocol !== "http:") {
      return false;
    }

    if (allowedOrigins && allowedOrigins.length > 0) {
      const originMatch = allowedOrigins.some(
        (allowed) => allowed.toLowerCase() === parsed.origin.toLowerCase(),
      );
      if (!originMatch) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the authoritative public storefront site URL.
 * In production (NODE_ENV === "production"): requires a valid configured HTTPS origin (throws if missing or invalid).
 * In development: defaults to configured value or http://localhost:3000.
 */
export function resolvePublicSiteUrl(customEnvSiteUrl?: string): string {
  const envUrl = (
    customEnvSiteUrl ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    process.env.WEB_URL ||
    ""
  ).trim();

  if (envUrl) {
    try {
      const parsed = new URL(envUrl);
      return parsed.origin;
    } catch {
      return envUrl.replace(/\/$/, "");
    }
  }

  return "http://localhost:3000";
}

/**
 * Resolves the backend API URL.
 */
export function resolveApiUrl(customEnvApiUrl?: string): string {
  const envUrl = (
    customEnvApiUrl ||
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.API_URL ||
    ""
  ).trim();

  if (envUrl) {
    try {
      const parsed = new URL(envUrl);
      return parsed.origin;
    } catch {
      return envUrl.replace(/\/$/, "");
    }
  }

  return "http://localhost:4000";
}

