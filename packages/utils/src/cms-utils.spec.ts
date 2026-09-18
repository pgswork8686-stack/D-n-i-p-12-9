import { slugify, removeVietnameseAccents, isReservedSlug } from "./slugify";
import { sanitizeContentHtml } from "./sanitize";
import { isValidCanonicalUrl } from "./url-validator";
import { safeJsonLd } from "./json-ld";
import { toMajorUnit } from "./money";

describe("CMS & SEO Utilities", () => {
  describe("Slugify & Vietnamese Accents", () => {
    it("converts Vietnamese titled string to clean normalized slug", () => {
      const input = "Thiết kế Website Chuẩn SEO";
      const slug = slugify(input);
      expect(slug).toBe("thiet-ke-website-chuan-seo");
    });

    it("removes Vietnamese accents directly", () => {
      expect(removeVietnameseAccents("Hà Nội Đẹp Nhất Về Đêm")).toBe("Ha Noi Dep Nhat Ve Dem");
    });

    it("handles complex diacritics and special symbols", () => {
      const input = "Hướng dẫn cài đặt Elementor Pro & WooCommerce 2026!";
      const slug = slugify(input);
      expect(slug).toBe("huong-dan-cai-dat-elementor-pro-woocommerce-2026");
    });

    it("collapses multiple dashes and trims edges", () => {
      const input = "---WordPress---theme---development---";
      const slug = slugify(input);
      expect(slug).toBe("wordpress-theme-development");
    });

    it("identifies reserved slugs", () => {
      expect(isReservedSlug("admin")).toBe(true);
      expect(isReservedSlug("category")).toBe(true);
      expect(isReservedSlug("login")).toBe(true);
      expect(isReservedSlug("my-unique-article")).toBe(false);
    });
  });

  describe("HTML Content Sanitization - XSS Attack Matrix", () => {
    it("strips executable <script> tags completely", () => {
      const malicious = '<p>Hello world</p><script>alert("XSS")</script><p>End</p>';
      const sanitized = sanitizeContentHtml(malicious);
      expect(sanitized).not.toContain("<script");
      expect(sanitized).not.toContain('alert("XSS")');
      expect(sanitized).toContain("<p>Hello world</p>");
      expect(sanitized).toContain("<p>End</p>");
    });

    it("strips inline event handlers like onerror and onload", () => {
      const malicious = '<img src="https://example.com/valid.jpg" onerror="alert(1)" onload="evil()" alt="pic">';
      const sanitized = sanitizeContentHtml(malicious);
      expect(sanitized).not.toContain("onerror");
      expect(sanitized).not.toContain("onload");
      expect(sanitized).not.toContain("evil()");
      expect(sanitized).toContain('src="https://example.com/valid.jpg"');
      expect(sanitized).toContain('alt="pic"');
    });

    it("neutralizes literal javascript: href", () => {
      const malicious = '<a href="javascript:alert(1)">Click me</a>';
      const sanitized = sanitizeContentHtml(malicious);
      expect(sanitized).not.toContain("javascript:");
      expect(sanitized).not.toContain("alert(1)");
      expect(sanitized).toContain("<a>Click me</a>");
    });

    it("neutralizes entity-encoded javascript: href (&#x73;)", () => {
      const malicious = '<a href="java&#x73;cript:alert(1)">x</a>';
      const sanitized = sanitizeContentHtml(malicious);
      expect(sanitized).not.toContain("alert(1)");
      expect(sanitized).not.toContain("javascript:");
      expect(sanitized).toContain("<a>x</a>");
    });

    it("neutralizes decimal entity-encoded javascript: href (&#97;)", () => {
      const malicious = '<a href="jav&#97;script:alert(1)">x</a>';
      const sanitized = sanitizeContentHtml(malicious);
      expect(sanitized).not.toContain("alert(1)");
      expect(sanitized).not.toContain("javascript:");
      expect(sanitized).toContain("<a>x</a>");
    });

    it("neutralizes mixed-casing and whitespace obfuscated javascript: href", () => {
      const malicious = '<a href="JaVaScRiPt:alert(1)">x</a>';
      const sanitized = sanitizeContentHtml(malicious);
      expect(sanitized).not.toContain("alert(1)");
      expect(sanitized).not.toContain("JaVaScRiPt");
      expect(sanitized).toContain("<a>x</a>");
    });

    it("neutralizes tab/newline obfuscated scheme", () => {
      const malicious = '<a href="jav&#x09;ascript:alert(1)">x</a>';
      const sanitized = sanitizeContentHtml(malicious);
      expect(sanitized).not.toContain("alert(1)");
      expect(sanitized).toContain("<a>x</a>");
    });

    it("removes dangerous <iframe>, <object>, <embed>", () => {
      const malicious = '<iframe src="https://example.com"></iframe><object data="test"></object><embed src="evil.swf">';
      const sanitized = sanitizeContentHtml(malicious);
      expect(sanitized).not.toContain("<iframe");
      expect(sanitized).not.toContain("<object");
      expect(sanitized).not.toContain("<embed");
    });

    it("neutralizes SVG with onload and xlink:href", () => {
      const malicious = '<svg onload="alert(1)"><a xlink:href="javascript:alert(2)"><text>click</text></a></svg>';
      const sanitized = sanitizeContentHtml(malicious);
      expect(sanitized).not.toContain("<svg");
      expect(sanitized).not.toContain("onload");
      expect(sanitized).not.toContain("xlink:href");
      expect(sanitized).not.toContain("alert(1)");
      expect(sanitized).not.toContain("alert(2)");
    });

    it("strips style attribute to prevent CSS-based URL injection", () => {
      const malicious = '<p style="background-image: url(javascript:alert(1))">content</p>';
      const sanitized = sanitizeContentHtml(malicious);
      expect(sanitized).not.toContain("style");
      expect(sanitized).not.toContain("javascript:");
      expect(sanitized).toContain("<p>content</p>");
    });

    it("disallows data: URIs in img src and links", () => {
      const malicious = '<img src="data:image/svg+xml;base64,PHN2Zz4=" alt="bad"><a href="data:text/html,<script>alert(1)</script>">link</a>';
      const sanitized = sanitizeContentHtml(malicious);
      expect(sanitized).not.toContain("data:");
      expect(sanitized).not.toContain("<script");
    });

    it("preserves safe formatting HTML tags and safe links", () => {
      const safe = '<p>This is <strong>bold</strong> and <em>italic</em> with a <a href="https://example.com">link</a>.</p>';
      const sanitized = sanitizeContentHtml(safe);
      expect(sanitized).toBe(safe);
    });
  });

  describe("Canonical URL Validator", () => {
    it("accepts valid https and http URLs", () => {
      expect(isValidCanonicalUrl("https://example.com/blog/my-post")).toBe(true);
      expect(isValidCanonicalUrl("http://localhost:3000/blog/test")).toBe(true);
    });

    it("rejects dangerous or unsupported URI schemes", () => {
      expect(isValidCanonicalUrl("javascript:alert(1)")).toBe(false);
      expect(isValidCanonicalUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
      expect(isValidCanonicalUrl("ftp://example.com/file")).toBe(false);
    });

    it("rejects protocol-relative and malformed URLs", () => {
      expect(isValidCanonicalUrl("//evil.com/path")).toBe(false);
      expect(isValidCanonicalUrl("not-a-valid-url")).toBe(false);
      expect(isValidCanonicalUrl("")).toBe(false);
      expect(isValidCanonicalUrl("   ")).toBe(false);
    });

    it("enforces allowed origins if specified", () => {
      const allowed = ["https://example.com", "https://nexustheme.com"];
      expect(isValidCanonicalUrl("https://example.com/article", allowed)).toBe(true);
      expect(isValidCanonicalUrl("https://malicious.com/article", allowed)).toBe(false);
    });
  });

  describe("Safe JSON-LD Structured Data", () => {
    it("escapes script breakout sequences in JSON-LD output", () => {
      const data = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: 'Article with </script><script>alert("hack")</script>',
        description: "Test <tag> and & entity",
      };
      const serialized = safeJsonLd(data);
      expect(serialized).not.toContain("</script>");
      expect(serialized).not.toContain("<script>");
      expect(serialized).toContain("\\u003c/script\\u003e");
      expect(serialized).toContain("\\u0026");
    });
  });

  describe("toMajorUnit Structured Data Money Converter", () => {
    it("converts USD cents to major unit dollars", () => {
      expect(toMajorUnit(1200, "USD")).toBe(12);
      expect(toMajorUnit(1250, "USD")).toBe(12.5);
      expect(toMajorUnit(99, "USD")).toBe(0.99);
      expect(toMajorUnit(0, "USD")).toBe(0);
    });

    it("preserves VND integer amount without decimal division", () => {
      expect(toMajorUnit(299000, "VND")).toBe(299000);
      expect(toMajorUnit(50000, "VND")).toBe(50000);
    });
  });
});
