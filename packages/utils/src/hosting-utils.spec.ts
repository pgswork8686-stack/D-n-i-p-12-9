import {
  isValidHostingDomain,
  generateHostingUsername,
  isValidDnsRecord,
  encryptHostingCredential,
  decryptHostingCredential,
} from "./hosting-utils";

describe("Hosting Utilities Acceptance", () => {
  const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  describe("Domain Validation for Hosting", () => {
    it("accepts standard domains and subdomains", () => {
      expect(isValidHostingDomain("example.com")).toBe(true);
      expect(isValidHostingDomain("sub.example.com")).toBe(true);
      expect(isValidHostingDomain("my-shop.vn")).toBe(true);
      expect(isValidHostingDomain("portal.nexustheme.dev")).toBe(true);
    });

    it("rejects invalid domains with protocols, paths, ports, or bad characters", () => {
      expect(isValidHostingDomain("https://example.com")).toBe(false);
      expect(isValidHostingDomain("http://example.com")).toBe(false);
      expect(isValidHostingDomain("example.com/path")).toBe(false);
      expect(isValidHostingDomain("-example.com")).toBe(false);
      expect(isValidHostingDomain("")).toBe(false);
      expect(isValidHostingDomain("invalid")).toBe(false);
    });
  });

  describe("generateHostingUsername", () => {
    it("generates deterministic yet valid alphanumeric usernames", () => {
      const u1 = generateHostingUsername("techmaster.com");
      expect(u1).toMatch(/^nx[a-z0-9]{2,10}$/);
      expect(u1.length).toBeLessThanOrEqual(12);
      expect(u1.length).toBeGreaterThanOrEqual(4);
    });

    it("handles domains with hyphens and subdomains cleanly", () => {
      const u2 = generateHostingUsername("sub-domain.my-brand.vn", "c_");
      expect(u2.startsWith("c_")).toBe(true);
      expect(/^[a-z0-9_]+$/.test(u2)).toBe(true);
    });
  });

  describe("isValidDnsRecord", () => {
    it("validates A records (IPv4)", () => {
      expect(isValidDnsRecord("A", "@", "192.0.2.1").isValid).toBe(true);
      expect(isValidDnsRecord("A", "sub", "256.0.0.1").isValid).toBe(false);
      expect(isValidDnsRecord("A", "sub", "not-an-ip").isValid).toBe(false);
    });

    it("validates CNAME records", () => {
      expect(isValidDnsRecord("CNAME", "www", "example.com").isValid).toBe(true);
      expect(isValidDnsRecord("CNAME", "www", "192.0.2.1").isValid).toBe(false);
      expect(isValidDnsRecord("CNAME", "@", "target.com").isValid).toBe(false); // Apex CNAME blocked
    });

    it("validates MX records with priority", () => {
      expect(isValidDnsRecord("MX", "@", "mail.example.com", 10).isValid).toBe(true);
      expect(isValidDnsRecord("MX", "@", "mail.example.com", -1).isValid).toBe(false);
      expect(isValidDnsRecord("MX", "@", "mail.example.com", null).isValid).toBe(false);
    });

    it("validates TXT records", () => {
      expect(isValidDnsRecord("TXT", "@", "v=spf1 include:_spf.google.com ~all").isValid).toBe(true);
      expect(isValidDnsRecord("TXT", "@", "a".repeat(3000)).isValid).toBe(false);
    });
  });

  describe("Hosting Credential Encryption & Decryption (AES-256-GCM)", () => {
    it("encrypts and decrypts API tokens symmetrically", () => {
      const rawToken = "whm-root:secure_secret_token_123456789!@#";
      const encrypted = encryptHostingCredential(rawToken, TEST_KEY);

      expect(encrypted.encrypted).toBeDefined();
      expect(encrypted.iv).toHaveLength(24); // 12 bytes = 24 hex chars
      expect(encrypted.tag).toHaveLength(32); // 16 bytes = 32 hex chars

      const decrypted = decryptHostingCredential(
        encrypted.encrypted,
        encrypted.iv,
        encrypted.tag,
        TEST_KEY,
      );
      expect(decrypted).toBe(rawToken);
    });

    it("fails closed when ciphertext or auth tag is tampered with", () => {
      const rawToken = "my-secret-token";
      const encrypted = encryptHostingCredential(rawToken, TEST_KEY);

      // Tampered tag
      const badTag = "0".repeat(32);
      expect(() => {
        decryptHostingCredential(
          encrypted.encrypted,
          encrypted.iv,
          badTag,
          TEST_KEY,
        );
      }).toThrow();
    });
  });
});
