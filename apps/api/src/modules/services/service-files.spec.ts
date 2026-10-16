import { BadRequestException } from "@nestjs/common";
import { SERVICE_FILE_MAX_BYTES } from "@nexus/contracts";
import {
  buildServiceStorageKey,
  decodeMultipartFileName,
  hashClientIp,
  sanitizeFileName,
  sniffMimeType,
  validateServiceFile,
} from "./service-files";

const PDF = Buffer.from("%PDF-1.7\n...");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const EXE = Buffer.from("MZ\x90\x00\x03\x00");

const file = (originalname: string, buffer: Buffer, mimetype = "application/octet-stream") => ({
  originalname,
  mimetype,
  size: buffer.length,
  buffer,
});

describe("service file validation", () => {
  it("detects types from content, not from the declared MIME type", () => {
    expect(sniffMimeType(PDF, "brief.pdf")).toBe("application/pdf");
    expect(sniffMimeType(PNG, "logo.png")).toBe("image/png");
    expect(sniffMimeType(EXE, "brief.pdf")).toBeNull();
  });

  it("accepts ZIP containers only as Office documents by extension", () => {
    expect(sniffMimeType(ZIP, "spec.docx")).toContain("wordprocessingml");
    expect(sniffMimeType(ZIP, "archive.zip")).toBeNull();
  });

  it("accepts plain UTF-8 text but rejects binary disguised as .txt", () => {
    expect(sniffMimeType(Buffer.from("Yêu cầu tính năng", "utf8"), "notes.txt")).toBe("text/plain");
    expect(sniffMimeType(Buffer.from([0x41, 0x00, 0x42]), "notes.txt")).toBeNull();
  });

  it("rejects a disguised executable even when the client claims application/pdf", () => {
    expect(() => validateServiceFile(file("invoice.pdf", EXE, "application/pdf"))).toThrow(BadRequestException);
  });

  it("rejects files over the size limit", () => {
    const big = Buffer.alloc(SERVICE_FILE_MAX_BYTES + 1);
    PDF.copy(big);
    expect(() => validateServiceFile(file("big.pdf", big))).toThrow(BadRequestException);
  });

  it("rejects empty files", () => {
    expect(() => validateServiceFile(file("empty.pdf", Buffer.alloc(0)))).toThrow(BadRequestException);
  });

  it("returns the sniffed type, size and checksum", () => {
    const v = validateServiceFile(file("brief.pdf", PDF, "image/png"));
    expect(v.mimeType).toBe("application/pdf");
    expect(v.sizeBytes).toBe(PDF.length);
    expect(v.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("strips path segments and control characters from file names", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\a\\Báo giá.pdf")).toBe("Báo giá.pdf");
    expect(sanitizeFileName("a\u0000b\r\n<c>.pdf")).toBe("abc.pdf");
    expect(sanitizeFileName("")).toBe("file");
  });

  it("restores UTF-8 file names that multipart parsing decoded as latin1", () => {
    const mojibake = Buffer.from("Yêu cầu.pdf", "utf8").toString("latin1");
    expect(decodeMultipartFileName(mojibake)).toBe("Yêu cầu.pdf");
    expect(sanitizeFileName(mojibake)).toBe("Yêu cầu.pdf");
    // Already-correct names and genuine latin1 names are left untouched.
    expect(decodeMultipartFileName("Yêu cầu.pdf")).toBe("Yêu cầu.pdf");
    expect(decodeMultipartFileName("café.pdf")).toBe("café.pdf");
    expect(decodeMultipartFileName("plain.pdf")).toBe("plain.pdf");
  });

  it("generates storage keys server-side without the client file name", () => {
    const key = buildServiceStorageKey("inquiries", "inq-1", "../../secret name.PDF");
    expect(key).toMatch(/^services\/inquiries\/inq-1\/[0-9a-f-]{36}\.pdf$/);
  });

  it("hashes client IPs with a salt", () => {
    expect(hashClientIp("1.2.3.4", "a")).not.toBe(hashClientIp("1.2.3.4", "b"));
    expect(hashClientIp("1.2.3.4", "a")).not.toContain("1.2.3.4");
  });
});
