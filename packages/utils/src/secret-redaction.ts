import { redactSensitiveFields } from "./observability-utils";

/**
 * Phase 19 — value-level secret redaction for AI execution logs, tool outputs and context text.
 *
 * `redactSensitiveFields` (observability) redacts by KEY name. AI tool outputs and free text can
 * carry secrets under innocent keys ("note", "output"), so this module also redacts by VALUE
 * pattern: provider API keys, bearer/JWT tokens, private keys, connection strings with
 * credentials, Stripe/webhook secrets and NEXUSTHEME license keys.
 */
export const SECRET_VALUE_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "private_key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "openai_key", pattern: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}\b/g },
  { name: "stripe_key", pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g },
  { name: "stripe_webhook", pattern: /\bwhsec_[A-Za-z0-9_]{8,}\b/g },
  { name: "github_token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: "google_api_key", pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { name: "aws_access_key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "slack_token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: "bearer", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi },
  { name: "connection_string", pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|s3|https?):\/\/[^\s:@/]+:[^\s@/]+@[^\s]+/gi },
  { name: "nexus_license_key", pattern: /\bNXS-(?:[0-9A-F]{4}-){7}[0-9A-F]{4}\b/gi },
  { name: "assignment", pattern: /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|service[_-]?role[_-]?key)\s*[:=]\s*["']?[^\s"',;]{6,}/gi },
];

export const REDACTED = "[REDACTED]";

/** Redacts secret-looking substrings inside a string. */
export function redactSecretText(text: string): string {
  let out = text;
  for (const { pattern } of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/** True if the text contains anything that looks like a credential. */
export function containsSecret(text: string): boolean {
  return SECRET_VALUE_PATTERNS.some(({ pattern }) => {
    pattern.lastIndex = 0;
    const hit = pattern.test(text);
    pattern.lastIndex = 0;
    return hit;
  });
}

/** Deep redaction: sensitive keys (observability rules) plus secret-looking string values. */
export function redactSecretsDeep<T>(value: T, depth = 0): T {
  if (depth > 12 || value === null || value === undefined) return value;
  if (typeof value === "string") return redactSecretText(value) as unknown as T;
  if (typeof value !== "object") return value;
  const keyRedacted = redactSensitiveFields(value);
  if (Array.isArray(keyRedacted)) {
    return keyRedacted.map((v) => redactSecretsDeep(v, depth + 1)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(keyRedacted as Record<string, unknown>)) {
    out[k] = redactSecretsDeep(v, depth + 1);
  }
  return out as T;
}

/** Truncates large tool payloads before they are stored in the audit trail. */
export function summarizeForAudit(value: unknown, maxChars = 4000): unknown {
  const redacted = redactSecretsDeep(value);
  const json = JSON.stringify(redacted ?? null);
  if (json.length <= maxChars) return redacted;
  return { truncated: true, preview: json.slice(0, maxChars), originalLength: json.length };
}
