import { formatMoney, toMinorUnit } from "./money";

describe("Money Utility", () => {
  describe("formatMoney", () => {
    it("formats USD cents to dollar representation", () => {
      expect(formatMoney(1200, "USD")).toBe("$12.00");
      expect(formatMoney(2400, "USD")).toBe("$24.00");
      expect(formatMoney(3900, "USD")).toBe("$39.00");
      expect(formatMoney(0, "USD")).toBe("$0.00");
      expect(formatMoney(99, "USD")).toBe("$0.99");
    });

    it("formats VND dongs appropriately", () => {
      const formatted = formatMoney(299000, "VND");
      expect(formatted).toContain("299");
      expect(formatted).toContain("₫");
    });

    it("rejects non-integer amounts to prevent float inaccuracies", () => {
      expect(() => formatMoney(12.5, "USD")).toThrow(TypeError);
      expect(() => formatMoney(299000.5, "VND")).toThrow(TypeError);
    });

    it("handles fallback for other currencies", () => {
      expect(formatMoney(500, "EUR")).toBe("500 EUR");
    });
  });

  describe("toMinorUnit", () => {
    it("converts USD major unit to cents", () => {
      expect(toMinorUnit(12.0, "USD")).toBe(1200);
      expect(toMinorUnit(12.99, "USD")).toBe(1299);
    });

    it("preserves VND major unit as integer minor unit", () => {
      expect(toMinorUnit(299000, "VND")).toBe(299000);
    });
  });
});
