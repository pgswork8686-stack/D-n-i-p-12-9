export const STORAGE_SERVICE = "STORAGE_SERVICE";

export interface StorageHealthResult {
  status: "ok" | "error";
  latencyMs?: number;
  message?: string;
}

export interface StorageObjectMetadata {
  contentLength: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
}

export interface StorageIntegrityVerificationResult {
  valid: boolean;
  actualSha256: string;
  actualSizeBytes: number;
}

export interface SignedDownloadUrlOptions {
  ttlSeconds?: number;
  filename?: string;
}

export interface IStorageService {
  isHealthy(): Promise<StorageHealthResult>;
  getSignedDownloadUrl(key: string, ttlSeconds?: number): Promise<string>;
  createSignedDownloadUrl(
    key: string,
    options?: SignedDownloadUrlOptions,
  ): Promise<string>;
  uploadFile(key: string, data: Buffer, contentType?: string): Promise<string>;
  headObject(key: string): Promise<StorageObjectMetadata | null>;
  deleteObject(key: string): Promise<void>;
  verifyObjectIntegrity(
    key: string,
    expectedSha256?: string,
    expectedSizeBytes?: number,
  ): Promise<StorageIntegrityVerificationResult>;
}
