import {
  normalizeAffiliateCode,
  isReservedAffiliateCode,
  parseReferralCookie,
  buildReferralCookie,
  hashClientFingerprint,
  AFFILIATE_COOKIE_NAME,
} from "./affiliate-utils";

describe("affiliate-utils", () => {
  describe("normalizeAffiliateCode", () => {
    it("should normalize valid lowercase code to uppercase", () => {
      expect(normalizeAffiliateCode("partner123")).toBe("PARTNER123");
    });

    it("should allow underscores and hyphens", () => {
      expect(normalizeAffiliateCode("my-aff_link")).toBe("MY-AFF_LINK");
    });

    it("should trim surrounding whitespace", () => {
      expect(normalizeAffiliateCode("  diep86  ")).toBe("DIEP86");
    });

    it("should throw for codes shorter than 3 chars", () => {
      expect(() => normalizeAffiliateCode("ab")).toThrow("at least 3 characters");
    });

    it("should throw for codes longer than 32 chars", () => {
      expect(() => normalizeAffiliateCode("a".repeat(33))).toThrow("at most 32 characters");
    });

    it("should throw for reserved words", () => {
      expect(() => normalizeAffiliateCode("admin")).toThrow("is reserved");
      expect(() => normalizeAffiliateCode("checkout")).toThrow("is reserved");
      expect(() => normalizeAffiliateCode("portal")).toThrow("is reserved");
    });

    it("should throw for non-string or empty input", () => {
      expect(() => normalizeAffiliateCode("")).toThrow("non-empty string");
      expect(() => normalizeAffiliateCode(null as any)).toThrow("non-empty string");
    });
  });

  describe("isReservedAffiliateCode", () => {
    it("should return true for reserved words case-insensitively", () => {
      expect(isReservedAffiliateCode("ADMIN")).toBe(true);
      expect(isReservedAffiliateCode("admin")).toBe(true);
      expect(isReservedAffiliateCode("Support")).toBe(true);
    });

    it("should return false for regular affiliate codes", () => {
      expect(isReservedAffiliateCode("TOPSELLER")).toBe(false);
      expect(isReservedAffiliateCode("DEV_PRO")).toBe(false);
    });
  });

  describe("parseReferralCookie", () => {
    it("should parse affiliate code from cookie string", () => {
      const cookieHeader = `session=abc; ${AFFILIATE_COOKIE_NAME}=PARTNER99; theme=dark`;
      expect(parseReferralCookie(cookieHeader)).toBe("PARTNER99");
    });

    it("should return null if cookie is missing", () => {
      expect(parseReferralCookie("session=abc; other=123")).toBeNull();
      expect(parseReferralCookie("")).toBeNull();
      expect(parseReferralCookie(undefined)).toBeNull();
    });

    it("should normalize parsed cookie value", () => {
      const cookieHeader = `${AFFILIATE_COOKIE_NAME}=diep86`;
      expect(parseReferralCookie(cookieHeader)).toBe("DIEP86");
    });

    it("should return null if cookie value is invalid or reserved", () => {
      const cookieHeader = `${AFFILIATE_COOKIE_NAME}=admin`;
      expect(parseReferralCookie(cookieHeader)).toBeNull();
    });
  });

  describe("buildReferralCookie", () => {
    it("should construct valid set-cookie string", () => {
      const cookie = buildReferralCookie("PROMO123", 30, true);
      expect(cookie).toContain(`${AFFILIATE_COOKIE_NAME}=PROMO123`);
      expect(cookie).toContain("Max-Age=2592000"); // 30 * 86400
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Secure");
    });

    it("should support non-secure for local testing", () => {
      const cookie = buildReferralCookie("PROMO123", 7, false);
      expect(cookie).toContain("Max-Age=604800");
      expect(cookie).not.toContain("Secure");
    });
  });

  describe("hashClientFingerprint", () => {
    it("should return deterministic sha256 hashes", () => {
      const res1 = hashClientFingerprint("1.2.3.4", "Mozilla/5.0");
      const res2 = hashClientFingerprint("1.2.3.4", "Mozilla/5.0");
      expect(res1.ipHash).toBe(res2.ipHash);
      expect(res1.uaHash).toBe(res2.uaHash);
      expect(res1.ipHash).toHaveLength(64);
    });

    it("should handle empty or null values gracefully", () => {
      const res = hashClientFingerprint(null, undefined);
      expect(res.ipHash).toHaveLength(64);
      expect(res.uaHash).toHaveLength(64);
    });
  });
});
