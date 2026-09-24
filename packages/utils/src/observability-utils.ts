export const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /credit[-_]?card/i,
  /card[-_]?number/i,
  /cvv/i,
  /cvc/i,
  /authencryptedtoken/i,
  /encrypted[-_]?password/i,
  /api[-_]?key/i,
  /private[-_]?key/i,
  /cookie/i,
];

export interface MemoryUsageStatsDto {
  rssMb: number;
  heapTotalMb: number;
  heapUsedMb: number;
  externalMb: number;
}

export interface StructuredLogPayload {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  correlationId: string;
  service: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  userId?: string;
  ip?: string;
  userAgent?: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Deeply redact sensitive attributes from arbitrary data payloads,
 * preventing security/PCI/credential leaks in telemetry and logs.
 */
export function redactSensitiveFields<T = unknown>(target: T, depth = 0): T {
  if (depth > 10 || target === null || target === undefined) {
    return target;
  }

  if (typeof target !== "object") {
    return target;
  }

  if (Array.isArray(target)) {
    return target.map((item) =>
      redactSensitiveFields(item, depth + 1),
    ) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(target as Record<string, unknown>)) {
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) =>
      pattern.test(key),
    );
    if (isSensitive) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactSensitiveFields(value, depth + 1);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

/**
 * Capture Node.js process memory metrics converted to Megabytes (MB).
 */
export function getMemoryUsageStats(): MemoryUsageStatsDto {
  const mem = process.memoryUsage();
  const toMb = (bytes: number) =>
    Math.round((bytes / 1024 / 1024) * 100) / 100;

  return {
    rssMb: toMb(mem.rss),
    heapTotalMb: toMb(mem.heapTotal),
    heapUsedMb: toMb(mem.heapUsed),
    externalMb: toMb(mem.external),
  };
}

/**
 * Get standard production-grade HTTP security response headers
 * conforming to OWASP secure headers best practices.
 */
export function getDefaultSecurityHeaders(): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=()",
    "Strict-Transport-Security":
      "max-age=31536000; includeSubDomains; preload",
  };
}

/**
 * Format a StructuredLogPayload into a standardized single-line JSON string.
 */
export function formatStructuredLog(entry: StructuredLogPayload): string {
  const sanitizedDetails = entry.details
    ? redactSensitiveFields(entry.details)
    : undefined;

  return JSON.stringify({
    ...entry,
    details: sanitizedDetails,
  });
}
