import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { ServiceFileDownloadResponse } from "@nexus/contracts";
import { IStorageService, STORAGE_SERVICE } from "../storage/storage.interface";
import { ValidatedServiceFile, buildServiceStorageKey } from "./service-files";
import { asciiFileName } from "./services.mappers";

export const FILE_URL_TTL_SECONDS = 120;

export type StoredServiceFile = ValidatedServiceFile & { storageKey: string };

/** Private object storage for inquiry attachments and project documents. */
@Injectable()
export class ServiceFileStore {
  private readonly logger = new Logger(ServiceFileStore.name);

  constructor(@Inject(STORAGE_SERVICE) private readonly storage: IStorageService) {}

  /** Uploads every file or none: a partial failure removes what was already stored. */
  async uploadAll(
    scope: "inquiries" | "projects",
    ownerId: string,
    files: ValidatedServiceFile[],
  ): Promise<StoredServiceFile[]> {
    const uploaded: StoredServiceFile[] = [];
    try {
      for (const f of files) {
        const storageKey = buildServiceStorageKey(scope, ownerId, f.fileName);
        await this.storage.uploadFile(storageKey, f.buffer, f.mimeType);
        uploaded.push({ ...f, storageKey });
      }
    } catch (err: any) {
      await this.deleteObjects(uploaded.map((f) => f.storageKey));
      this.logger.error(`Service file upload failed: ${err?.message || err}`);
      throw new BadRequestException("Không thể lưu tệp đính kèm. Vui lòng thử lại.");
    }
    return uploaded;
  }

  /** Best-effort cleanup of objects whose database rows were never committed. */
  async deleteObjects(keys: string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.storage.deleteObject(key);
      } catch (err: any) {
        this.logger.warn(`Failed to clean up orphaned object ${key}: ${err?.message || err}`);
      }
    }
  }

  async signedUrl(storageKey: string, fileName: string): Promise<ServiceFileDownloadResponse> {
    const url = await this.storage.createSignedDownloadUrl(storageKey, {
      ttlSeconds: FILE_URL_TTL_SECONDS,
      filename: asciiFileName(fileName),
    });
    return { url, expiresInSeconds: FILE_URL_TTL_SECONDS };
  }
}
