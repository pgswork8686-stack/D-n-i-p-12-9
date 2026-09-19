/**
 * Utility functions for currency formatting and minor currency unit manipulation.
 *
 * Money Semantics:
 * - All monetary amounts in database and contracts are stored as non-negative INTEGERS
 *   representing minor currency units.
 * - VND: minor unit = 1 dong (e.g., 299000 -> ₫299,000 / 299.000 ₫)
 * - USD: minor unit = cents (1/100 of a dollar) (e.g., 1200 -> $12.00)
 */

export function formatMoney(amountMinor: number, currency: string): string {
  if (!Number.isInteger(amountMinor)) {
    throw new TypeError(
      `Amount must be an integer (minor currency unit), received: ${amountMinor}`,
    );
  }

  const normalizedCurrency = currency.toUpperCase();

  if (normalizedCurrency === "USD") {
    const dollars = amountMinor / 100;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(dollars);
  }

  if (normalizedCurrency === "VND") {
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: "VND",
      maximumFractionDigits: 0,
    }).format(amountMinor);
  }

  return `${amountMinor} ${normalizedCurrency}`;
}

/**
 * Converts a major currency unit (e.g. 12.00 USD or 299000 VND) into integer minor unit.
 */
export function toMinorUnit(amountMajor: number, currency: string): number {
  const normalizedCurrency = currency.toUpperCase();
  if (normalizedCurrency === "USD") {
    return Math.round(amountMajor * 100);
  }
  if (normalizedCurrency === "VND") {
    return Math.round(amountMajor);
  }
  return Math.round(amountMajor);
}

/**
 * Converts integer minor currency unit (e.g. 1200 USD cents or 299000 VND dong)
 * into major unit for structured data / decimal displays.
 * e.g.:
 * USD 1200 -> 12
 * VND 299000 -> 299000
 */
export function toMajorUnit(amountMinor: number, currency: string): number {
  const normalizedCurrency = (currency || "").toUpperCase();
  if (normalizedCurrency === "USD") {
    return Number((amountMinor / 100).toFixed(2));
  }
  if (normalizedCurrency === "VND") {
    return amountMinor;
  }
  return amountMinor;
}

