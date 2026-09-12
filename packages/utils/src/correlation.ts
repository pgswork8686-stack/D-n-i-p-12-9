import { randomUUID } from "crypto";

/**
 * Generate a unique correlation ID for tracking requests and jobs across services.
 */
export function generateCorrelationId(prefix = "req"): string {
  return `${prefix}_${randomUUID()}`;
}

/**
 * Normalize a given domain name by removing protocol, trailing slash, and path.
 */
export function normalizeDomain(domain: string): string {
  if (!domain) return "";
  let clean = domain.trim().toLowerCase();
  clean = clean.replace(/^https?:\/\//, "");
  clean = clean.replace(/\/.*$/, "");
  clean = clean.replace(/:\d+$/, "");
  return clean;
}
