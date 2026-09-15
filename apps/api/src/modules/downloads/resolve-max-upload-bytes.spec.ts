import {
  resolveMaxUploadBytes,
  resolveDownloadTtl,
  DEFAULT_MAX_UPLOAD_BYTES,
  DOWNLOAD_SIGNED_URL_DEFAULT_TTL,
} from "@nexus/contracts";

describe("Downloads Contracts Helpers", () => {
  describe("resolveMaxUploadBytes", () => {
    it("returns default 50 MiB when unset / undefined / null / empty", () => {
      expect(resolveMaxUploadBytes()).toBe(DEFAULT_MAX_UPLOAD_BYTES);
      expect(resolveMaxUploadBytes(undefined)).toBe(DEFAULT_MAX_UPLOAD_BYTES);
      expect(resolveMaxUploadBytes(null)).toBe(DEFAULT_MAX_UPLOAD_BYTES);
      expect(resolveMaxUploadBytes("")).toBe(DEFAULT_MAX_UPLOAD_BYTES);
      expect(resolveMaxUploadBytes("   ")).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    });

    it("accepts valid numeric string '1048576'", () => {
      expect(resolveMaxUploadBytes("1048576")).toBe(1048576);
    });

    it("accepts valid number 1048576", () => {
      expect(resolveMaxUploadBytes(1048576)).toBe(1048576);
    });

    it("fails closed on non-numeric string 'abc'", () => {
      expect(() => resolveMaxUploadBytes("abc")).toThrow(
        /Invalid MAX_UPLOAD_BYTES configuration/,
      );
    });

    it("fails closed on 'NaN'", () => {
      expect(() => resolveMaxUploadBytes("NaN")).toThrow(
        /Invalid MAX_UPLOAD_BYTES configuration/,
      );
    });

    it("fails closed on 'Infinity'", () => {
      expect(() => resolveMaxUploadBytes("Infinity")).toThrow(
        /Invalid MAX_UPLOAD_BYTES configuration/,
      );
    });

    it("fails closed on negative value '-1'", () => {
      expect(() => resolveMaxUploadBytes("-1")).toThrow(
        /Invalid MAX_UPLOAD_BYTES/,
      );
    });

    it("fails closed on zero '0'", () => {
      expect(() => resolveMaxUploadBytes("0")).toThrow(
        /Invalid MAX_UPLOAD_BYTES/,
      );
    });

    it("fails closed above hard ceiling '999999999999999999'", () => {
      expect(() => resolveMaxUploadBytes("999999999999999999")).toThrow(
        /Invalid MAX_UPLOAD_BYTES/,
      );
    });
  });

  describe("resolveDownloadTtl", () => {
    it("returns default TTL when unset", () => {
      expect(resolveDownloadTtl()).toBe(DOWNLOAD_SIGNED_URL_DEFAULT_TTL);
    });

    it("clamps between 120 and 300", () => {
      expect(resolveDownloadTtl(60)).toBe(120);
      expect(resolveDownloadTtl(600)).toBe(300);
      expect(resolveDownloadTtl(200)).toBe(200);
    });
  });
});
