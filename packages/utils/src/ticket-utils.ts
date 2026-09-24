import * as crypto from "crypto";

export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
  "application/json",
];

export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Generates an alphanumeric human-readable support ticket identifier.
 * Format: TK-YYYYMM-XXXX (e.g. TK-202609-A4F2)
 */
export function generateTicketNumber(prefix = "TK"): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const randomSuffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${year}${month}-${randomSuffix}`;
}

/**
 * Sanitizes ticket and message content:
 * - Trims whitespace
 * - Strips unsafe HTML tags (<script>, <iframe>, <object>, <embed>)
 * - Strips javascript: URLs and inline event handlers (onerror=, onclick=)
 */
export function sanitizeTicketContent(content: string): string {
  if (!content || typeof content !== "string") return "";

  let cleaned = content.trim();

  // Strip script/iframe/object/embed tags and their contents
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  cleaned = cleaned.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");
  cleaned = cleaned.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "");
  cleaned = cleaned.replace(/<object\b[^>]*\/?>/gi, "");
  cleaned = cleaned.replace(/<\/object>/gi, "");
  cleaned = cleaned.replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, "");
  cleaned = cleaned.replace(/<embed\b[^>]*\/?>/gi, "");
  cleaned = cleaned.replace(/<\/embed>/gi, "");

  // Strip dangerous protocol references
  cleaned = cleaned.replace(/javascript:[^"'\s]*/gi, "#unsafe-script-removed");
  cleaned = cleaned.replace(/data:text\/html[^"'\s]*/gi, "#unsafe-data-removed");

  // Strip inline event attributes like onclick=, onerror=, onload=
  cleaned = cleaned.replace(/\son\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, "");

  return cleaned;
}

/**
 * Validates whether an attachment mime type and file size comply with security policy.
 */
export function isValidAttachment(
  mimeType: string,
  sizeBytes: number,
  maxSizeBytes = MAX_ATTACHMENT_SIZE_BYTES,
): { isValid: boolean; error?: string } {
  if (!mimeType || typeof mimeType !== "string") {
    return { isValid: false, error: "MIME type must be specified" };
  }

  const normalizedMime = mimeType.trim().toLowerCase();
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(normalizedMime)) {
    return {
      isValid: false,
      error: `File type '${mimeType}' is not supported. Allowed formats: images, PDF, text, JSON, and ZIP archives.`,
    };
  }

  if (typeof sizeBytes !== "number" || sizeBytes <= 0) {
    return { isValid: false, error: "File size must be greater than zero bytes" };
  }

  if (sizeBytes > maxSizeBytes) {
    return {
      isValid: false,
      error: `File size exceeds the maximum allowed limit of ${Math.round(maxSizeBytes / (1024 * 1024))} MB`,
    };
  }

  return { isValid: true };
}

/**
 * Verifies if ticket priority string is a valid enum value.
 */
export function isValidTicketPriority(priority: string): boolean {
  return ["LOW", "NORMAL", "HIGH", "URGENT"].includes(priority);
}

/**
 * Verifies if ticket status string is a valid enum value.
 */
export function isValidTicketStatus(status: string): boolean {
  return ["OPEN", "WAITING_CUSTOMER", "IN_PROGRESS", "RESOLVED", "CLOSED"].includes(status);
}
