import type { ProductVersionDto, ProductVersionFileDto, VersionStatus } from "@nexus/contracts";
import { DEFAULT_MAX_UPLOAD_BYTES } from "@nexus/contracts";

export function adminVersionStatusLabel(status: VersionStatus): string {
  return status === "PUBLISHED" ? "Đã phát hành" : "Nháp";
}

export function parseAdminVersionList(data: unknown): ProductVersionDto[] {
  if (!Array.isArray(data)) throw new Error("Invalid version list response");
  for (const item of data) {
    if (!item || typeof item !== "object" || typeof (item as ProductVersionDto).id !== "string") {
      throw new Error("Invalid version item");
    }
  }
  return data as ProductVersionDto[];
}

export function parseAdminVersion(data: unknown): ProductVersionDto {
  if (!data || typeof data !== "object" || typeof (data as ProductVersionDto).id !== "string") {
    throw new Error("Invalid version response");
  }
  return data as ProductVersionDto;
}

/** Newest first: drafts, then by creation time. */
export function sortAdminVersions(versions: ProductVersionDto[]): ProductVersionDto[] {
  return [...versions].sort((a, b) => {
    if (a.status !== b.status) return a.status === "DRAFT" ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/** Semantic-version-like label; the API only requires a non-empty string. */
export function validateVersionLabel(value: string): string | null {
  const v = value.trim();
  if (!v) return "Vui lòng nhập số phiên bản.";
  if (v.length > 40) return "Số phiên bản tối đa 40 ký tự.";
  if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(v)) return "Số phiên bản nên có dạng 1.2.3 (có thể kèm -beta.1).";
  return null;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1).replace(".", ",") + " KB";
  return (bytes / 1024 / 1024).toFixed(1).replace(".", ",") + " MB";
}

/** UI guard; the server enforces its own MAX_UPLOAD_BYTES (default 50 MiB). */
export function validateUploadFile(file: { name: string; size: number } | null, maxBytes = DEFAULT_MAX_UPLOAD_BYTES): string | null {
  if (!file) return "Chọn tệp .zip để tải lên.";
  if (file.size <= 0) return "Tệp rỗng.";
  if (file.size > maxBytes) return "Tệp vượt quá " + formatBytes(maxBytes) + " (giới hạn mặc định của máy chủ).";
  if (!/\.zip$/i.test(file.name)) return "Chỉ chấp nhận tệp .zip.";
  return null;
}

export function shortSha(sha256: string): string {
  return sha256 && sha256.length > 12 ? sha256.slice(0, 4) + "…" + sha256.slice(-4) : sha256 || "—";
}

/** A version can be published only when it is a draft with at least one verified file and a primary file. */
export function publishBlockReason(version: ProductVersionDto): string | null {
  if (version.status === "PUBLISHED") return "Phiên bản đã phát hành và không thể sửa.";
  const files: ProductVersionFileDto[] = version.files ?? [];
  if (files.length === 0) return "Cần tải lên ít nhất một tệp trước khi phát hành.";
  if (!files.some(file => file.isPrimary)) return "Cần đánh dấu một tệp chính.";
  return null;
}
