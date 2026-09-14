import { normalizeDomain, isValidDomain } from "./domain-normalizer";

describe("Domain Normalizer", () => {
  describe("Valid domains normalization", () => {
    it("normalizes simple domain to lowercase", () => {
      expect(normalizeDomain("EXAMPLE.COM")).toBe("example.com");
      expect(normalizeDomain("example.com")).toBe("example.com");
    });

    it("strips http and https protocols", () => {
      expect(normalizeDomain("https://example.com")).toBe("example.com");
      expect(normalizeDomain("http://example.com")).toBe("example.com");
      expect(normalizeDomain("https://EXAMPLE.COM")).toBe("example.com");
    });

    it("strips www prefix correctly", () => {
      expect(normalizeDomain("www.example.com")).toBe("example.com");
      expect(normalizeDomain("https://www.example.com/")).toBe("example.com");
      expect(normalizeDomain("http://WWW.EXAMPLE.COM")).toBe("example.com");
    });

    it("preserves subdomains and strips www only from prefix", () => {
      expect(normalizeDomain("app.example.com")).toBe("app.example.com");
      expect(normalizeDomain("https://sub.domain.example.co.uk")).toBe("sub.domain.example.co.uk");
      expect(normalizeDomain("www.sub.example.com")).toBe("sub.example.com");
    });

    it("strips ports, paths, queries, and fragments", () => {
      expect(normalizeDomain("https://example.com:8443/some/path?param=1#section")).toBe("example.com");
      expect(normalizeDomain("http://user:pass@www.example.com:8080/")).toBe("example.com");
    });

    it("strips trailing dots and whitespace", () => {
      expect(normalizeDomain("  example.com.  ")).toBe("example.com");
      expect(normalizeDomain("https://www.example.com./")).toBe("example.com");
    });

    it("handles IDN (internationalized domain names) deterministically using punycode", () => {
      expect(normalizeDomain("münchen.de")).toBe("xn--mnchen-3ya.de");
      expect(normalizeDomain("https://www.münchen.de/")).toBe("xn--mnchen-3ya.de");
    });
  });

  describe("Rejections and invalid inputs", () => {
    it("rejects empty or null inputs", () => {
      expect(() => normalizeDomain("")).toThrow("Domain is required");
      expect(() => normalizeDomain("   ")).toThrow("Domain cannot be empty");
      expect(() => normalizeDomain(null as any)).toThrow("Domain is required");
      expect(() => normalizeDomain(undefined as any)).toThrow("Domain is required");
    });

    it("rejects wildcard domains", () => {
      expect(() => normalizeDomain("*.example.com")).toThrow("Wildcard");
      expect(() => normalizeDomain("*")).toThrow("Wildcard");
    });

    it("rejects protocol-only strings", () => {
      expect(() => normalizeDomain("http://")).toThrow("Invalid domain");
      expect(() => normalizeDomain("https://")).toThrow("Invalid domain");
    });

    it("rejects path-only strings without host", () => {
      expect(() => normalizeDomain("/path/to/resource")).toThrow("Invalid domain");
      expect(() => normalizeDomain("http:///foo")).toThrow("Invalid domain");
    });

    it("rejects localhost", () => {
      expect(() => normalizeDomain("localhost")).toThrow("Localhost");
      expect(() => normalizeDomain("http://localhost:3000")).toThrow("Localhost");
      expect(() => normalizeDomain("sub.localhost")).toThrow("Localhost");
    });

    it("rejects IPv4 addresses", () => {
      expect(() => normalizeDomain("127.0.0.1")).toThrow("Raw IPv4");
      expect(() => normalizeDomain("http://192.168.1.1:8080")).toThrow("Raw IPv4");
      expect(() => normalizeDomain("8.8.8.8")).toThrow("Raw IPv4");
    });

    it("rejects IPv6 addresses", () => {
      expect(() => normalizeDomain("[::1]")).toThrow("IPv6");
      expect(() => normalizeDomain("http://[fe80::1]:8080")).toThrow("IPv6");
    });

    it("rejects domains without valid TLD", () => {
      expect(() => normalizeDomain("example")).toThrow("Invalid domain structure");
      expect(() => normalizeDomain("localdomain")).toThrow("Invalid domain structure");
    });

    it("rejects invalid characters in labels", () => {
      expect(() => normalizeDomain("exam ple.com")).toThrow("Invalid domain");
      expect(() => normalizeDomain("-example.com")).toThrow("invalid characters or starts/ends with a hyphen");
      expect(() => normalizeDomain("example-.com")).toThrow("invalid characters or starts/ends with a hyphen");
    });
  });

  describe("isValidDomain helper", () => {
    it("returns true for valid domains", () => {
      expect(isValidDomain("https://www.example.com/")).toBe(true);
      expect(isValidDomain("sub.my-site.org")).toBe(true);
    });

    it("returns false for invalid domains", () => {
      expect(isValidDomain("")).toBe(false);
      expect(isValidDomain("localhost")).toBe(false);
      expect(isValidDomain("192.168.0.1")).toBe(false);
      expect(isValidDomain("*.example.com")).toBe(false);
    });
  });
});
