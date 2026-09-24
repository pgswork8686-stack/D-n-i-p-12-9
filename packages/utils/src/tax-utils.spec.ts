import {
  calculateTaxMinor,
  resolveTaxRate,
  isValidVatFormat,
  generateInvoiceNumber,
  isZeroSumLedger,
} from "./tax-utils";

describe("tax-utils", () => {
  describe("calculateTaxMinor", () => {
    it("calculates exact minor tax with rounding", () => {
      // $100.00 (10000 cents) at 8.25% (825 bp) -> 825 cents
      expect(calculateTaxMinor(10000, 825)).toBe(825);

      // $49.99 (4999 cents) at 19% (1900 bp) -> 949.81 -> 950 cents
      expect(calculateTaxMinor(4999, 1900)).toBe(950);

      // Zero subtotal or zero rate yields 0
      expect(calculateTaxMinor(0, 1900)).toBe(0);
      expect(calculateTaxMinor(10000, 0)).toBe(0);
    });
  });

  describe("resolveTaxRate", () => {
    it("resolves US sales tax by state", () => {
      const ca = resolveTaxRate("US", "CA");
      expect(ca.jurisdiction).toBe("US");
      expect(ca.rateBasisPoints).toBe(725);
      expect(ca.isReverseCharge).toBe(false);

      const ny = resolveTaxRate("US", "NY");
      expect(ny.rateBasisPoints).toBe(887);

      const def = resolveTaxRate("US");
      expect(def.rateBasisPoints).toBe(600);
    });

    it("resolves Vietnam 10% VAT", () => {
      const vn = resolveTaxRate("VN");
      expect(vn.jurisdiction).toBe("VN");
      expect(vn.rateBasisPoints).toBe(1000);
      expect(vn.isReverseCharge).toBe(false);
    });

    it("resolves EU VAT and applies reverse charge for valid B2B VAT", () => {
      // B2C France
      const b2c = resolveTaxRate("FR", undefined, false);
      expect(b2c.jurisdiction).toBe("EU");
      expect(b2c.rateBasisPoints).toBe(2000);
      expect(b2c.isReverseCharge).toBe(false);

      // B2B Germany with valid VAT
      const b2b = resolveTaxRate("DE", undefined, true, "DE123456789");
      expect(b2b.jurisdiction).toBe("EU");
      expect(b2b.rateBasisPoints).toBe(0);
      expect(b2b.isReverseCharge).toBe(true);

      // B2B Germany with invalid VAT falls back to standard VAT
      const invalidB2b = resolveTaxRate("DE", undefined, true, "");
      expect(invalidB2b.rateBasisPoints).toBe(1900);
      expect(invalidB2b.isReverseCharge).toBe(false);
    });

    it("resolves UK VAT with B2B reverse charge support", () => {
      const ukB2c = resolveTaxRate("GB");
      expect(ukB2c.jurisdiction).toBe("UK");
      expect(ukB2c.rateBasisPoints).toBe(2000);
      expect(ukB2c.isReverseCharge).toBe(false);

      const ukB2b = resolveTaxRate("GB", undefined, true, "GB123456789");
      expect(ukB2b.rateBasisPoints).toBe(0);
      expect(ukB2b.isReverseCharge).toBe(true);
    });

    it("resolves Australia 10% GST", () => {
      const au = resolveTaxRate("AU");
      expect(au.jurisdiction).toBe("AU");
      expect(au.rateBasisPoints).toBe(1000);
    });

    it("returns zero tax for Rest of World (ROW)", () => {
      const row = resolveTaxRate("JP");
      expect(row.jurisdiction).toBe("ROW");
      expect(row.rateBasisPoints).toBe(0);
      expect(row.isReverseCharge).toBe(false);
    });
  });

  describe("isValidVatFormat", () => {
    it("validates Vietnam tax code format", () => {
      expect(isValidVatFormat("VN", "0101234567")).toBe(true);
      expect(isValidVatFormat("VN", "0101234567-001")).toBe(true);
      expect(isValidVatFormat("VN", "123")).toBe(false);
    });

    it("validates UK VAT number format", () => {
      expect(isValidVatFormat("GB", "GB123456789")).toBe(true);
      expect(isValidVatFormat("GB", "123456789")).toBe(true);
      expect(isValidVatFormat("GB", "SHORT")).toBe(false);
    });

    it("validates EU VAT numbers", () => {
      expect(isValidVatFormat("DE", "DE123456789")).toBe(true);
      expect(isValidVatFormat("FR", "FR12345678901")).toBe(true);
      expect(isValidVatFormat("DE", "")).toBe(false);
    });
  });

  describe("generateInvoiceNumber", () => {
    it("generates formatted invoice identifier", () => {
      const inv = generateInvoiceNumber("INV");
      expect(/^INV-\d{6}-[A-F0-9]{6}$/.test(inv)).toBe(true);
    });
  });

  describe("isZeroSumLedger", () => {
    it("verifies double-entry balanced transactions", () => {
      // Customer payment: Debit Cash ($100), Credit Revenue ($90), Credit Tax ($10)
      const balanced = [
        { entryType: "DEBIT" as const, amountMinor: 10000 },
        { entryType: "CREDIT" as const, amountMinor: 9000 },
        { entryType: "CREDIT" as const, amountMinor: 1000 },
      ];
      expect(isZeroSumLedger(balanced)).toBe(true);
    });

    it("detects unbalanced ledger transactions", () => {
      const unbalanced = [
        { entryType: "DEBIT" as const, amountMinor: 10000 },
        { entryType: "CREDIT" as const, amountMinor: 9500 },
      ];
      expect(isZeroSumLedger(unbalanced)).toBe(false);
    });

    it("rejects negative ledger entries", () => {
      const negative = [
        { entryType: "DEBIT" as const, amountMinor: -100 },
        { entryType: "CREDIT" as const, amountMinor: -100 },
      ];
      expect(isZeroSumLedger(negative)).toBe(false);
    });
  });
});
