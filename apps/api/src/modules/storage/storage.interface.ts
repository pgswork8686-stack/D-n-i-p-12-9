export const STORAGE_SERVICE = "STORAGE_SERVICE";

export interface StorageHealthResult {
  status: "ok" | "error";
  latencyMs?: number;
  message?: string;
}

export interface IStorageService {
  isHealthy(): Promise<StorageHealthResult>;
  getSignedDownloadUrl(key: string, ttlSeconds?: number): Promise<string>;
  uploadFile(key: string, data: Buffer, contentType?: string): Promise<string>;
}
