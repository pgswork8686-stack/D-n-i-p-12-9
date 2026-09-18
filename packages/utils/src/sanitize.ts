import sanitizeHtml from "sanitize-html";

export const ALLOWED_CONTENT_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "code",
  "pre",
  "a",
  "img",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "hr",
];

export const ALLOWED_CONTENT_ATTRIBUTES: Record<string, string[]> = {
  a: ["href", "title", "target", "rel"],
  img: ["src", "alt", "title", "width", "height", "loading"],
  th: ["colspan", "rowspan", "scope"],
  td: ["colspan", "rowspan"],
};

/**
 * Robust HTML content sanitization pipeline using an authoritative parser allowlist.
 * Neutralizes scripts, inline event handlers, style attributes, and unsafe schemes
 * (including entity-encoded and obfuscated javascript: / data: / vbscript:).
 */
export function sanitizeContentHtml(rawHtml: string): string {
  if (!rawHtml || typeof rawHtml !== "string") return "";

  return sanitizeHtml(rawHtml, {
    allowedTags: ALLOWED_CONTENT_TAGS,
    allowedAttributes: ALLOWED_CONTENT_ATTRIBUTES,
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {
      img: ["http", "https"],
      a: ["http", "https", "mailto"],
    },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => {
        if (attribs.target === "_blank") {
          attribs.rel = "noopener noreferrer";
        }
        return {
          tagName,
          attribs,
        };
      },
    },
  });
}

