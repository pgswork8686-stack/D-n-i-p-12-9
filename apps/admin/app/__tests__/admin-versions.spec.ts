import type { ProductVersionDto } from "@nexus/contracts";
import {
  formatBytes, parseAdminVersion, parseAdminVersionList, publishBlockReason, shortSha,
  sortAdminVersions, validateUploadFile, validateVersionLabel,
} from "../lib/admin-versions";

const ver = (over: Partial<ProductVersionDto> = {}): ProductVersionDto => ({
  id: "v1", productId: "p1", version: "1.0.0", status: "DRAFT", releaseNotes: null, releasedAt: null,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", files: [], ...over,
});
const file = (isPrimary: boolean) => ({
  id: "f1", productVersionId: "v1", storageKey: "k", fileName: "a.zip", contentType: "application/zip",
  sizeBytes: 10, sha256: "a".repeat(64), isPrimary, verifiedAt: null, createdAt: "x", updatedAt: "x",
});

describe("AD05 Admin product versions helpers", () => {
  it("validates responses", () => {
    expect(() => parseAdminVersionList({})).toThrow();
    expect(() => parseAdminVersionList([{ nope: 1 }])).toThrow();
    expect(parseAdminVersionList([ver()])).toHaveLength(1);
    expect(() => parseAdminVersion(null)).toThrow();
    expect(parseAdminVersion(ver()).id).toBe("v1");
  });
  it("lists drafts first, newest first within a status", () => {
    const sorted = sortAdminVersions([
      ver({ id: "old", status: "PUBLISHED", createdAt: "2026-01-01T00:00:00Z" }),
      ver({ id: "new", status: "PUBLISHED", createdAt: "2026-03-01T00:00:00Z" }),
      ver({ id: "draft", status: "DRAFT", createdAt: "2026-02-01T00:00:00Z" }),
    ]);
    expect(sorted.map(v => v.id)).toEqual(["draft", "new", "old"]);
  });
  it("validates the version label", () => {
    expect(validateVersionLabel("")).not.toBeNull();
    expect(validateVersionLabel("v1")).not.toBeNull();
    expect(validateVersionLabel("3.4.0")).toBeNull();
    expect(validateVersionLabel("3.4.0-beta.1")).toBeNull();
    expect(validateVersionLabel("1.2.3".padEnd(60, "0"))).not.toBeNull();
  });
  it("validates uploads before sending", () => {
    expect(validateUploadFile(null)).not.toBeNull();
    expect(validateUploadFile({ name: "a.zip", size: 0 })).not.toBeNull();
    expect(validateUploadFile({ name: "a.exe", size: 10 })).not.toBeNull();
    expect(validateUploadFile({ name: "a.zip", size: 51 * 1024 * 1024 })).not.toBeNull();
    expect(validateUploadFile({ name: "A.ZIP", size: 1024 })).toBeNull();
  });
  it("blocks publishing until there is a primary file and the version is a draft", () => {
    expect(publishBlockReason(ver({ files: [] }))).toContain("ít nhất một tệp");
    expect(publishBlockReason(ver({ files: [file(false)] }))).toContain("tệp chính");
    expect(publishBlockReason(ver({ files: [file(true)] }))).toBeNull();
    expect(publishBlockReason(ver({ status: "PUBLISHED", files: [file(true)] }))).toContain("đã phát hành");
  });
  it("formats sizes and shortens hashes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2,0 KB");
    expect(formatBytes(18.9 * 1024 * 1024)).toBe("18,9 MB");
    expect(formatBytes(-1)).toBe("—");
    expect(shortSha("a".repeat(64))).toBe("aaaa…aaaa");
  });
});
