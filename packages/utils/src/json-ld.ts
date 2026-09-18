/**
 * Safely serialize JSON-LD structured data for HTML <script> embedding.
 * Escapes characters such as '<', '>', and '&' to prevent script breakout attacks.
 */
export function safeJsonLd(data: unknown): string {
  const json = JSON.stringify(data);
  if (!json) return "{}";
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}
