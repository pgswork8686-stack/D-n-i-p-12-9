import { randomUUID } from "crypto";

/**
 * Generate a unique correlation ID for tracking requests and jobs across services.
 */
export function generateCorrelationId(prefix = "req"): string {
  return `${prefix}_${randomUUID()}`;
}

