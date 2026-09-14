export type VersionStatus = "DRAFT" | "PUBLISHED";
export type DownloadChannel = "CUSTOMER_PORTAL" | "LICENSE_UPDATER";

export const DOWNLOAD_SIGNED_URL_DEFAULT_TTL = 180;
export const DOWNLOAD_SIGNED_URL_MIN_TTL = 120;
export const DOWNLOAD_SIGNED_URL_MAX_TTL = 300;

export const DOWNLOAD_RATE_LIMIT_MAX = 10;
export const DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS = 600; // 10 minutes

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
