import {
  generateTicketNumber,
  sanitizeTicketContent,
  isValidAttachment,
  isValidTicketPriority,
  isValidTicketStatus,
  MAX_ATTACHMENT_SIZE_BYTES,
} from "./ticket-utils";

describe("Ticket Utilities Acceptance", () => {
  describe("generateTicketNumber", () => {
    it("generates deterministic formatted ticket identifiers", () => {
      const t1 = generateTicketNumber();
      expect(t1).toMatch(/^TK-\d{6}-[A-F0-9]{6}$/);

      const t2 = generateTicketNumber("HD");
      expect(t2.startsWith("HD-")).toBe(true);
    });

    it("ensures randomness across consecutive invocations", () => {
      const set = new Set();
      for (let i = 0; i < 50; i++) {
        set.add(generateTicketNumber());
      }
      expect(set.size).toBe(50);
    });
  });

  describe("sanitizeTicketContent", () => {
    it("preserves safe plain text and standard formatting", () => {
      const input = "Hello, my license key is having activation issues on WordPress 6.6.";
      expect(sanitizeTicketContent(input)).toBe(input);
    });

    it("strips malicious <script> tags and payloads", () => {
      const dangerous = "Error log: <script>alert('pwned')</script> please fix";
      expect(sanitizeTicketContent(dangerous)).toBe("Error log:  please fix");
    });

    it("strips malicious <iframe> and <object> tags", () => {
      const dangerous = "Check this: <iframe src='http://evil.com'></iframe>";
      expect(sanitizeTicketContent(dangerous)).toBe("Check this: ");
    });

    it("strips inline event handlers (onerror, onclick)", () => {
      const dangerous = "<img src='x' onerror='stealData()' /> Hello";
      const cleaned = sanitizeTicketContent(dangerous);
      expect(cleaned).not.toContain("onerror");
      expect(cleaned).toContain("<img src='x' /> Hello");
    });

    it("strips javascript: protocol pseudo-URLs", () => {
      const dangerous = "<a href='javascript:doBadThings()'>Click me</a>";
      const cleaned = sanitizeTicketContent(dangerous);
      expect(cleaned).not.toContain("javascript:");
    });
  });

  describe("isValidAttachment", () => {
    it("accepts valid image, PDF, and archive formats", () => {
      expect(isValidAttachment("image/png", 1024 * 50).isValid).toBe(true);
      expect(isValidAttachment("application/pdf", 1024 * 1024).isValid).toBe(true);
      expect(isValidAttachment("application/zip", 1024 * 1024 * 5).isValid).toBe(true);
      expect(isValidAttachment("text/plain", 500).isValid).toBe(true);
    });

    it("rejects unsupported executable or script mime types", () => {
      expect(isValidAttachment("application/x-msdownload", 1024).isValid).toBe(false);
      expect(isValidAttachment("text/javascript", 1024).isValid).toBe(false);
      expect(isValidAttachment("application/x-sh", 1024).isValid).toBe(false);
    });

    it("rejects files exceeding maximum size limit (25 MB)", () => {
      const tooLarge = MAX_ATTACHMENT_SIZE_BYTES + 1;
      const res = isValidAttachment("image/png", tooLarge);
      expect(res.isValid).toBe(false);
      expect(res.error).toContain("exceeds the maximum allowed limit");
    });

    it("rejects non-positive file sizes", () => {
      expect(isValidAttachment("image/png", 0).isValid).toBe(false);
      expect(isValidAttachment("image/png", -10).isValid).toBe(false);
    });
  });

  describe("Enum Validation", () => {
    it("validates ticket priorities accurately", () => {
      expect(isValidTicketPriority("LOW")).toBe(true);
      expect(isValidTicketPriority("NORMAL")).toBe(true);
      expect(isValidTicketPriority("HIGH")).toBe(true);
      expect(isValidTicketPriority("URGENT")).toBe(true);
      expect(isValidTicketPriority("INVALID")).toBe(false);
    });

    it("validates ticket statuses accurately", () => {
      expect(isValidTicketStatus("OPEN")).toBe(true);
      expect(isValidTicketStatus("WAITING_CUSTOMER")).toBe(true);
      expect(isValidTicketStatus("IN_PROGRESS")).toBe(true);
      expect(isValidTicketStatus("RESOLVED")).toBe(true);
      expect(isValidTicketStatus("CLOSED")).toBe(true);
      expect(isValidTicketStatus("UNKNOWN")).toBe(false);
    });
  });
});
