const PLACEHOLDER_SECRETS = new Set(["placeholder", "changeme", "secret"]);

/**
 * Validates whether a secret satisfies the strong production policy.
 * Throws a descriptive, non-leaking error on violation.
 * Normalizes input by trimming whitespace first.
 */
export function validateAutomationServiceSecret(secret?: string | null): string {
  if (!secret || secret.trim() === "") {
    throw new Error("Missing required AUTOMATION_SERVICE_SECRET in production");
  }

  const normalized = secret.trim();
  const lower = normalized.toLowerCase();

  if (
    PLACEHOLDER_SECRETS.has(lower) ||
    lower.includes("placeholder") ||
    lower.includes("changeme") ||
    normalized.length < 32
  ) {
    throw new Error(
      "Insecure AUTOMATION_SERVICE_SECRET in production: minimum 32 chars required and cannot be a placeholder",
    );
  }

  return normalized;
}

/**
 * Resolves AUTOMATION_SERVICE_SECRET with production fail-closed policy.
 * Shared between the worker (dispatch signing) and API (HMAC guard) so the
 * placeholder policy is enforced identically everywhere.
 *
 * Production policy:
 *  - missing/empty -> throw
 *  - placeholder/changeme/secret (exact or containing "placeholder"/"changeme") -> throw
 *  - shorter than 32 chars after trim -> throw
 * Dev/test policy: missing secret resolves to "" (signing skipped).
 */
export function resolveAutomationServiceSecret(): string {
  const secret = process.env.AUTOMATION_SERVICE_SECRET;
  const isProduction = process.env.NODE_ENV === "production";

  if (!secret || secret.trim() === "") {
    if (isProduction) {
      throw new Error(
        "Missing required AUTOMATION_SERVICE_SECRET in production",
      );
    }
    return "";
  }

  const normalized = secret.trim();

  if (isProduction) {
    return validateAutomationServiceSecret(normalized);
  }

  return normalized;
}
