import { BadRequestException } from "@nestjs/common";
import * as crypto from "crypto";
import * as path from "path";
import {
  SERVICE_FILE_ALLOWED_MIME_TYPES,
  SERVICE_FILE_MAX_BYTES,
} from "@nexus/contracts";

export interface UploadedServiceFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface ValidatedServiceFile {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  buffer: Buffer;
}

const OOXML_BY_EXTENSION: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/**
 * Detects the real file type from its leading bytes. The client-declared
 * MIME type is never trusted.
 */
export function sniffMimeType(buffer: Buffer, fileName: string): string | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-") {
    return "application/pdf";
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    // Office Open XML documents are ZIP containers; only accept them by extension.
    return OOXML_BY_EXTENSION[path.extname(fileName).toLowerCase()] ?? null;
  }
  if (path.extname(fileName).toLowerCase() === ".txt" && isPlainUtf8Text(buffer)) {
    return "text/plain";
  }
  return null;
}

function isPlainUtf8Text(buffer: Buffer): boolean {
  if (buffer.includes(0x00)) return false;
  const text = buffer.toString("utf8");
  return !text.includes("�");
}

/**
 * Busboy (via multer) decodes multipart file names as latin1, which turns
 * UTF-8 names such as "Yêu cầu.pdf" into mojibake. Re-decode as UTF-8 when the
 * name is a valid latin1 encoding of UTF-8 bytes; leave anything else as is.
 */
export function decodeMultipartFileName(name: string): string {
  if (!name) return name;
  const codes = Array.from(name, (ch) => ch.codePointAt(0) ?? 0);
  // Only strings made purely of latin1 code points, with at least one high byte, can be mis-decoded UTF-8.
  if (codes.some((c) => c > 0xff) || !codes.some((c) => c >= 0x80)) return name;
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return decoded.includes("�") ? name : decoded;
}

/** Keeps a display-safe base name: no path segments, control characters or quotes. */
export function sanitizeFileName(name: string): string {
  const base = path.basename(decodeMultipartFileName(String(name || "")).replace(/\\/g, "/"));
  const withoutControls = Array.from(base.normalize("NFC"))
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join("");
  const cleaned = withoutControls.replace(/["<>|*?:]/g, "").replace(/\s+/g, " ").trim();
  const limited = cleaned.slice(-120);
  return limited || "file";
}

export function validateServiceFile(file: UploadedServiceFile): ValidatedServiceFile {
  if (!file || !file.buffer || file.size <= 0) {
    throw new BadRequestException("Tệp đính kèm rỗng.");
  }
  if (file.size > SERVICE_FILE_MAX_BYTES || file.buffer.length > SERVICE_FILE_MAX_BYTES) {
    throw new BadRequestException(
      `Tệp vượt quá dung lượng cho phép (${SERVICE_FILE_MAX_BYTES / (1024 * 1024)} MB).`,
    );
  }
  const fileName = sanitizeFileName(file.originalname);
  const mimeType = sniffMimeType(file.buffer, fileName);
  if (!mimeType || !(SERVICE_FILE_ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw new BadRequestException(
      "Định dạng tệp không được hỗ trợ. Chấp nhận PDF, ảnh PNG/JPEG/WebP, TXT, DOCX, XLSX, PPTX.",
    );
  }
  return {
    fileName,
    mimeType,
    sizeBytes: file.buffer.length,
    sha256: crypto.createHash("sha256").update(file.buffer).digest("hex"),
    buffer: file.buffer,
  };
}

/** Storage keys are always generated server-side and never accepted from clients. */
export function buildServiceStorageKey(scope: "inquiries" | "projects", ownerId: string, fileName: string): string {
  const ext = path.extname(fileName).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return `services/${scope}/${ownerId}/${crypto.randomUUID()}${ext}`;
}

export function hashClientIp(ip: string | undefined, salt: string): string {
  return crypto.createHash("sha256").update(`${salt}:${ip || "unknown"}`).digest("hex");
}
