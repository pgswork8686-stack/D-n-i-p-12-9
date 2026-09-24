import * as crypto from "crypto";

export const AFFILIATE_COOKIE_NAME = "nexus_ref";
export const DEFAULT_COOKIE_MAX_AGE_DAYS = 30;
export const DEFAULT_COMMISSION_RATE_BP = 2000; // 20.00%
export const MIN_COMMISSION_RATE_BP = 100; // 1.00%
export const MAX_COMMISSION_RATE_BP = 5000; // 50.00%
export const MIN_PAYOUT_AMOUNT_VND = 500000; // 500,000 VND
export const MIN_PAYOUT_AMOUNT_USD = 5000; // $50.00 USD (in minor units / cents)

const RESERVED_AFFILIATE_CODES = new Set([
  "ADMIN",
  "API",
  "AUTH",
  "BILLING",
  "CART",
  "CHECKOUT",
  "DASHBOARD",
  "HELP",
  "LOGIN",
  "NEXUS",
  "OFFICIAL",
  "ORDER",
  "ORDERS",
  "PAYMENT",
  "PORTAL",
  "ROOT",
  "SUPPORT",
  "SYSTEM",
  "WEB",
]);

export function isReservedAffiliateCode(code: string): boolean {
  if (!code) return false;
  return RESERVED_AFFILIATE_CODES.has(code.trim().toUpperCase());
}

export function normalizeAffiliateCode(code: string): string {
  if (!code || typeof code !== "string") {
    throw new Error("Affiliate code must be a non-empty string");
  }

  const trimmed = code.trim().toUpperCase();
  const sanitized = trimmed.replace(/[^A-Z0-9_-]/g, "");

  if (sanitized.length < 3) {
    throw new Error("Affiliate code must be at least 3 characters long");
  }

  if (sanitized.length > 32) {
    throw new Error("Affiliate code must be at most 32 characters long");
  }

  if (isReservedAffiliateCode(sanitized)) {
    throw new Error(`Affiliate code '${sanitized}' is reserved and cannot be used`);
  }

  return sanitized;
}

export function parseReferralCookie(cookieHeader?: string | null): string | null {
  if (!cookieHeader || typeof cookieHeader !== "string") {
    return null;
  }

  const cookies = cookieHeader.split(";");
  for (const c of cookies) {
    const [rawKey, ...valParts] = c.trim().split("=");
    if (rawKey === AFFILIATE_COOKIE_NAME) {
      const val = valParts.join("=").trim();
      try {
        return normalizeAffiliateCode(val);
      } catch {
        return null;
      }
    }
  }

  return null;
}

export function buildReferralCookie(
  code: string,
  maxAgeDays: number = DEFAULT_COOKIE_MAX_AGE_DAYS,
  secure: boolean = true,
): string {
  const normalized = normalizeAffiliateCode(code);
  const maxAgeSeconds = Math.max(1, maxAgeDays) * 86400;
  const secureFlag = secure ? "; Secure" : "";
  return `${AFFILIATE_COOKIE_NAME}=${normalized}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secureFlag}`;
}

export function hashClientFingerprint(
  ipAddress?: string | null,
  userAgent?: string | null,
): { ipHash: string; uaHash: string } {
  const normalizedIp = (ipAddress || "").trim();
  const normalizedUa = (userAgent || "").trim();

  const ipHash = crypto
    .createHash("sha256")
    .update(normalizedIp || "unknown-ip")
    .digest("hex");

  const uaHash = crypto
    .createHash("sha256")
    .update(normalizedUa || "unknown-ua")
    .digest("hex");

  return { ipHash, uaHash };
}
