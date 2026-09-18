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
