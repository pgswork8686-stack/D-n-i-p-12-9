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

export interface UrlResolverOptions {
  isProduction?: boolean;
}

export function validateTrustedOrigin(
  rawUrl: string,
  contextName: string,
  isProduction: boolean,
): string {
  if (rawUrl.startsWith("//")) {
    throw new Error(`${contextName} cannot be protocol-relative: '${rawUrl}'`);
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid ${contextName} format: '${rawUrl}'`);
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "https:" && protocol !== "http:") {
    throw new Error(
      `Unsupported protocol '${parsed.protocol}' for ${contextName}. Only HTTP/HTTPS are supported.`,
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${contextName} cannot contain embedded credentials.`);
  }

  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]";

  if (isProduction) {
    if (protocol !== "https:") {
      throw new Error(
        `Production ${contextName} must use HTTPS: received '${rawUrl}'`,
      );
    }
    if (isLoopback) {
      throw new Error(
        `Production ${contextName} cannot target localhost/loopback address: received '${rawUrl}'`,
      );
    }
  }

  return parsed.origin;
}

/**
 * Resolves the authoritative public storefront site URL.
 * In production (NODE_ENV === "production"): requires a valid configured HTTPS origin (throws if missing or invalid).
 * In development: defaults to configured value or http://localhost:3000.
 */
export function resolvePublicSiteUrl(
  customEnvSiteUrl?: string,
  options?: UrlResolverOptions,
): string {
  const isProd =
    options?.isProduction !== undefined
      ? options.isProduction
      : process.env.NODE_ENV === "production";

  const rawUrl = (
    customEnvSiteUrl !== undefined
      ? customEnvSiteUrl
      : process.env.NEXT_PUBLIC_SITE_URL ||
        process.env.SITE_URL ||
        process.env.WEB_URL ||
        ""
  ).trim();

  if (isProd) {
    if (!rawUrl) {
      throw new Error(
        "Production requires a configured public site URL (NEXT_PUBLIC_SITE_URL or SITE_URL). None was provided.",
      );
    }
    return validateTrustedOrigin(rawUrl, "Site URL", true);
  }

  if (!rawUrl) {
    return "http://localhost:3000";
  }
  return validateTrustedOrigin(rawUrl, "Site URL", false);
}

/**
 * Resolves the backend API URL.
 * In production (NODE_ENV === "production"): requires a valid configured HTTPS origin (throws if missing or invalid).
 * In development: defaults to configured value or http://localhost:4000.
 */
export function resolveApiUrl(
  customEnvApiUrl?: string,
  options?: UrlResolverOptions,
): string {
  const isProd =
    options?.isProduction !== undefined
      ? options.isProduction
      : process.env.NODE_ENV === "production";

  const rawUrl = (
    customEnvApiUrl !== undefined
      ? customEnvApiUrl
      : process.env.NEXT_PUBLIC_API_URL ||
        process.env.API_URL ||
        ""
  ).trim();

  if (isProd) {
    if (!rawUrl) {
      throw new Error(
        "Production requires a configured API URL (NEXT_PUBLIC_API_URL or API_URL). None was provided.",
      );
    }
    return validateTrustedOrigin(rawUrl, "API URL", true);
  }

  if (!rawUrl) {
    return "http://localhost:4000";
  }
  return validateTrustedOrigin(rawUrl, "API URL", false);
}

export interface CorsOriginUrls {
  webUrl?: string;
  portalUrl?: string;
  adminUrl?: string;
}

/**
 * Resolves CORS allowed origins.
 *
 * In production (NODE_ENV === "production"):
 * - Fail-closed: WEB_URL, PORTAL_URL, and ADMIN_URL are all strictly required.
 * - Every URL must use HTTPS, cannot target loopback/localhost, and cannot contain embedded credentials.
 * - Returns strictly the verified, normalized origins of [WEB_URL, PORTAL_URL, ADMIN_URL] with zero default localhost origins.
 *
 * In non-production (development / test):
 * - Defaults missing URLs to http://localhost:3000 (WEB_URL), http://localhost:3001 (PORTAL_URL), http://localhost:3002 (ADMIN_URL).
 * - Preserves standard localhost origins [http://localhost:3000, http://localhost:3001, http://localhost:3002] in the allowlist.
 */
export function resolveCorsOrigins(
  urls: CorsOriginUrls,
  options?: UrlResolverOptions,
): string[] {
  const isProd =
    options?.isProduction !== undefined
      ? options.isProduction
      : process.env.NODE_ENV === "production";

  if (isProd) {
    const missing: string[] = [];
    if (!urls.webUrl || !urls.webUrl.trim()) missing.push("WEB_URL");
    if (!urls.portalUrl || !urls.portalUrl.trim()) missing.push("PORTAL_URL");
    if (!urls.adminUrl || !urls.adminUrl.trim()) missing.push("ADMIN_URL");

    if (missing.length > 0) {
      throw new Error(
        `Production requires configured URLs for CORS: missing [${missing.join(", ")}].`,
      );
    }

    const webOrigin = validateTrustedOrigin(urls.webUrl!.trim(), "WEB_URL", true);
    const portalOrigin = validateTrustedOrigin(urls.portalUrl!.trim(), "PORTAL_URL", true);
    const adminOrigin = validateTrustedOrigin(urls.adminUrl!.trim(), "ADMIN_URL", true);

    return Array.from(new Set([webOrigin, portalOrigin, adminOrigin]));
  }

  const webUrl = (urls.webUrl && urls.webUrl.trim()) || "http://localhost:3000";
  const portalUrl = (urls.portalUrl && urls.portalUrl.trim()) || "http://localhost:3001";
  const adminUrl = (urls.adminUrl && urls.adminUrl.trim()) || "http://localhost:3002";

  const webOrigin = validateTrustedOrigin(webUrl, "WEB_URL", false);
  const portalOrigin = validateTrustedOrigin(portalUrl, "PORTAL_URL", false);
  const adminOrigin = validateTrustedOrigin(adminUrl, "ADMIN_URL", false);

  return Array.from(
    new Set([
      webOrigin,
      portalOrigin,
      adminOrigin,
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
    ]),
  );
}
