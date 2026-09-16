export type VersionStatus = "DRAFT" | "PUBLISHED";
export type DownloadChannel = "CUSTOMER_PORTAL" | "LICENSE_UPDATER";

export const DOWNLOAD_SIGNED_URL_DEFAULT_TTL = 180;
export const DOWNLOAD_SIGNED_URL_MIN_TTL = 120;
export const DOWNLOAD_SIGNED_URL_MAX_TTL = 300;

export const DOWNLOAD_RATE_LIMIT_MAX = 10;
export const DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS = 600; // 10 minutes

export const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MiB
export const MIN_MAX_UPLOAD_BYTES = 1; // 1 byte min (strictly positive integer)
export const HARD_CEILING_MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MiB hard ceiling

export function resolveDownloadTtl(configuredTtl?: number | string | null): number {
  if (configuredTtl === undefined || configuredTtl === null || configuredTtl === "") {
    return DOWNLOAD_SIGNED_URL_DEFAULT_TTL;
  }
  const parsed = typeof configuredTtl === "number" ? configuredTtl : parseInt(configuredTtl, 10);
  if (isNaN(parsed) || !isFinite(parsed)) {
    return DOWNLOAD_SIGNED_URL_DEFAULT_TTL;
  }
  return Math.max(
    DOWNLOAD_SIGNED_URL_MIN_TTL,
    Math.min(DOWNLOAD_SIGNED_URL_MAX_TTL, Math.floor(parsed))
  );
}

export function resolveMaxUploadBytes(
  configuredValue?: unknown,
  _options?: { isProduction?: boolean },
): number {
  if (
    configuredValue === undefined ||
    configuredValue === null ||
    configuredValue === "" ||
    (typeof configuredValue === "string" && configuredValue.trim() === "")
  ) {
    return DEFAULT_MAX_UPLOAD_BYTES;
  }

  let num: number;
  if (typeof configuredValue === "number") {
    num = configuredValue;
  } else if (typeof configuredValue === "string") {
    const trimmed = configuredValue.trim();
    if (!/^-?\d+$/.test(trimmed)) {
      throw new Error(
        `Invalid MAX_UPLOAD_BYTES configuration '${configuredValue}'. Must be a positive integer.`,
      );
    }
    num = Number(trimmed);
  } else {
    throw new Error(
      `Invalid MAX_UPLOAD_BYTES configuration. Must be a number or numeric string.`,
    );
  }

  if (
    !Number.isFinite(num) ||
    !Number.isInteger(num) ||
    num < MIN_MAX_UPLOAD_BYTES ||
    num > HARD_CEILING_MAX_UPLOAD_BYTES
  ) {
    throw new Error(
      `Invalid MAX_UPLOAD_BYTES '${configuredValue}'. Must be an integer between ${MIN_MAX_UPLOAD_BYTES} and ${HARD_CEILING_MAX_UPLOAD_BYTES} bytes.`,
    );
  }

  return num;
}

export interface ProductVersionDto {
  id: string;
  productId: string;
  version: string;
  status: VersionStatus;
  releaseNotes: string | null;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
  files?: ProductVersionFileDto[];
}

export interface ProductVersionFileDto {
  id: string;
  productVersionId: string;
  storageKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  isPrimary: boolean;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerProductVersionFileDto {
  id: string;
  productVersionId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  isPrimary: boolean;
}

export interface CustomerProductVersionDto {
  id: string;
  productId: string;
  version: string;
  releaseNotes: string | null;
  releasedAt: string | null;
  files: CustomerProductVersionFileDto[];
}

export interface DownloadGrantDto {
  id: string;
  userId: string | null;
  entitlementId: string;
  productVersionId: string;
  fileId: string;
  channel: DownloadChannel;
  licenseId: string | null;
  normalizedDomain: string | null;
  issuedAt: string;
  expiresAt: string;
}


export interface CreateProductVersionRequest {
  version: string;
  releaseNotes?: string;
}

export interface PublishVersionResponse {
  success: boolean;
  version: ProductVersionDto;
}

export interface RequestDownloadRequest {
  entitlementId: string;
  versionId: string;
  fileId: string;
}

export interface DownloadUrlResponse {
  downloadUrl: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  expiresIn: number;
}

export interface CheckUpdateRequest {
  licenseKey: string;
  domain: string;
  productId: string;
  currentVersion: string;
}

export interface CheckUpdateResponse {
  valid: boolean;
  updateAvailable: boolean;
  version?: string;
  releasedAt?: string | null;
  releaseNotes?: string | null;
  sha256?: string;
  sizeBytes?: number;
  downloadUrl?: string;
}
