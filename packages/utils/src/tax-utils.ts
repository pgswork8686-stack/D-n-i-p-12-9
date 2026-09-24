import * as crypto from "crypto";

export type TaxJurisdiction = "US" | "EU" | "VN" | "UK" | "AU" | "ROW";

export const EU_COUNTRY_CODES = [
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
  "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT",
  "NL", "PL", "PT", "RO", "SE", "SI", "SK",
];

export const STANDARD_VAT_RATES_BP: Record<string, number> = {
  DE: 1900, // Germany 19%
  FR: 2000, // France 20%
  ES: 2100, // Spain 21%
  IT: 2200, // Italy 22%
  NL: 2100, // Netherlands 21%
  IE: 2300, // Ireland 23%
  SE: 2500, // Sweden 25%
  PL: 2300, // Poland 23%
  BE: 2100, // Belgium 21%
  AT: 2000, // Austria 20%
};

export const US_STATE_TAX_RATES_BP: Record<string, number> = {
  CA: 725, // California 7.25%
  NY: 887, // New York 8.875%
  TX: 625, // Texas 6.25%
  FL: 600, // Florida 6.0%
  WA: 650, // Washington 6.5%
};

/**
 * Calculates tax in minor units (e.g. cents) with half-up rounding.
 */
export function calculateTaxMinor(
  subtotalMinor: number,
  taxRateBasisPoints: number,
): number {
  if (subtotalMinor <= 0 || taxRateBasisPoints <= 0) {
    return 0;
  }
  const tax = (subtotalMinor * taxRateBasisPoints) / 10000;
  return Math.round(tax);
}

/**
 * Validates VAT / Tax ID syntax based on country code.
 */
export function isValidVatFormat(countryCode: string, vatId: string): boolean {
  if (!vatId || typeof vatId !== "string") return false;
  const clean = vatId.trim().toUpperCase().replace(/[\s\-.]/g, "");

  const code = countryCode.toUpperCase();

  if (code === "VN") {
    // Vietnam tax code: 10 digits or 13 digits (10 digits + 3 digits branch code)
    return /^\d{10}(\d{3})?$/.test(clean);
  }

  if (code === "GB" || code === "UK") {
    // UK VAT: GB followed by 9 or 12 digits
    return /^(GB)?\d{9}(\d{3})?$/.test(clean);
  }

  if (EU_COUNTRY_CODES.includes(code)) {
    // EU VAT typically starts with 2-letter country prefix followed by 8-12 alphanumeric
    const regex = new RegExp(`^(${code})?[A-Z0-9]{8,12}$`);
    return regex.test(clean);
  }

  // Generic fallback: at least 5 alphanumeric characters
  return /^[A-Z0-9]{5,20}$/.test(clean);
}

/**
 * Resolves effective tax rate, jurisdiction, and reverse-charge eligibility.
 */
export function resolveTaxRate(
  countryCode: string,
  stateCode?: string,
  isB2B = false,
  vatId?: string,
): {
  rateBasisPoints: number;
  jurisdiction: TaxJurisdiction;
  isReverseCharge: boolean;
  taxName: string;
} {
  const code = (countryCode || "").toUpperCase().trim();

  // 1. United States (Sales Tax)
  if (code === "US") {
    const state = (stateCode || "").toUpperCase().trim();
    const rate = US_STATE_TAX_RATES_BP[state] || 600; // default US 6%
    return {
      rateBasisPoints: rate,
      jurisdiction: "US",
      isReverseCharge: false,
      taxName: `${state || "US"} Sales Tax`,
    };
  }

  // 2. Vietnam (VAT)
  if (code === "VN") {
    return {
      rateBasisPoints: 1000, // 10% standard VAT
      jurisdiction: "VN",
      isReverseCharge: false,
      taxName: "Thuế Giá Trị Gia Tăng (VAT 10%)",
    };
  }

  // 3. United Kingdom (UK VAT)
  if (code === "GB" || code === "UK") {
    if (isB2B && vatId && isValidVatFormat("GB", vatId)) {
      return {
        rateBasisPoints: 0,
        jurisdiction: "UK",
        isReverseCharge: true,
        taxName: "UK VAT (Reverse Charge)",
      };
    }
    return {
      rateBasisPoints: 2000,
      jurisdiction: "UK",
      isReverseCharge: false,
      taxName: "UK VAT (20%)",
    };
  }

  // 4. Australia (GST)
  if (code === "AU") {
    return {
      rateBasisPoints: 1000,
      jurisdiction: "AU",
      isReverseCharge: false,
      taxName: "Australia GST (10%)",
    };
  }

  // 5. European Union (EU VAT & Reverse Charge)
  if (EU_COUNTRY_CODES.includes(code)) {
    if (isB2B && vatId && isValidVatFormat(code, vatId)) {
      return {
        rateBasisPoints: 0,
        jurisdiction: "EU",
        isReverseCharge: true,
        taxName: `EU VAT Reverse Charge (${code})`,
      };
    }
    const standardRate = STANDARD_VAT_RATES_BP[code] || 2000;
    return {
      rateBasisPoints: standardRate,
      jurisdiction: "EU",
      isReverseCharge: false,
      taxName: `EU VAT (${code} ${standardRate / 100}%)`,
    };
  }

  // 6. Rest of World (Zero tax liability)
  return {
    rateBasisPoints: 0,
    jurisdiction: "ROW",
    isReverseCharge: false,
    taxName: "Tax Exempt / Outside Scope",
  };
}

/**
 * Generates an alphanumeric invoice reference number.
 * Format: INV-YYYYMM-XXXX (e.g. INV-202609-F3C1)
 */
export function generateInvoiceNumber(prefix = "INV"): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const randomSuffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${year}${month}-${randomSuffix}`;
}

/**
 * Double-entry accounting verification invariant:
 * Sum of debits must strictly equal sum of credits.
 */
export function isZeroSumLedger(
  entries: { entryType: "DEBIT" | "CREDIT"; amountMinor: number }[],
): boolean {
  if (!entries || entries.length === 0) return true;

  let totalDebits = 0;
  let totalCredits = 0;

  for (const entry of entries) {
    if (entry.amountMinor < 0) return false;
    if (entry.entryType === "DEBIT") {
      totalDebits += entry.amountMinor;
    } else if (entry.entryType === "CREDIT") {
      totalCredits += entry.amountMinor;
    } else {
      return false;
    }
  }

  return totalDebits === totalCredits;
}
