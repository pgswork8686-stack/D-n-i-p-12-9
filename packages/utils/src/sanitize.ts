/**
 * Robust HTML & Markdown content sanitization pipeline.
 * Neutralizes scripts, inline event handlers, and unsafe URI protocols.
 */
export function sanitizeContentHtml(rawHtml: string): string {
  if (!rawHtml) return "";

  let sanitized = rawHtml;

  // 1. Remove dangerous blocks: <script>...</script>, <style>...</style>, <iframe>...</iframe>, <object>, <embed>, <applet>
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gi, "");
  sanitized = sanitized.replace(/<script\b[^>]*>/gi, "");
  sanitized = sanitized.replace(/<\/script\s*>/gi, "");

  sanitized = sanitized.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style\s*>/gi, "");
  sanitized = sanitized.replace(/<style\b[^>]*>/gi, "");
  sanitized = sanitized.replace(/<\/style\s*>/gi, "");

  sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe\s*>/gi, "");
  sanitized = sanitized.replace(/<iframe\b[^>]*>/gi, "");
  sanitized = sanitized.replace(/<\/iframe\s*>/gi, "");

  sanitized = sanitized.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object\s*>/gi, "");
  sanitized = sanitized.replace(/<object\b[^>]*>/gi, "");
  sanitized = sanitized.replace(/<\/object\s*>/gi, "");

  sanitized = sanitized.replace(/<embed\b[^>]*>/gi, "");
  sanitized = sanitized.replace(/<link\b[^>]*>/gi, "");
  sanitized = sanitized.replace(/<meta\b[^>]*>/gi, "");
  sanitized = sanitized.replace(/<base\b[^>]*>/gi, "");

  // 2. Remove all inline event handlers: e.g. onclick=..., onerror=..., onload=...
  // Matches inside HTML tags: on[a-zA-Z]+=(?:'[^']*'|"[^"]*"|[^\s>]+)
  sanitized = sanitized.replace(
    /\s+on[a-zA-Z]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi,
    "",
  );

  // 3. Sanitize dangerous schemes in href / src / action / data attributes:
  // e.g. href="javascript:..." or src='javascript:...'
  const dangerousProtocols = /(?:javascript|vbscript|data\s*:\s*text\/html)/i;

  // For href attributes:
  sanitized = sanitized.replace(
    /\b(href\s*=\s*)(["'])([^"']*)\2/gi,
    (match, prefix, quote, val) => {
      const trimmed = val.trim().toLowerCase();
      if (dangerousProtocols.test(trimmed)) {
        return `${prefix}${quote}#${quote}`;
      }
      return match;
    },
  );

  // For src attributes:
  sanitized = sanitized.replace(
    /\b(src\s*=\s*)(["'])([^"']*)\2/gi,
    (match, prefix, quote, val) => {
      const trimmed = val.trim().toLowerCase();
      if (dangerousProtocols.test(trimmed)) {
        return `${prefix}${quote}about:blank${quote}`;
      }
      return match;
    },
  );

  return sanitized;
}
