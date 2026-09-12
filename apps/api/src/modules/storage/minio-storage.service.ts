import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  S3Client,
  ListBucketsCommand,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { IStorageService, StorageHealthResult } from "./storage.interface";

@Injectable()
export class MinioStorageService implements IStorageService {
  private readonly logger = new Logger(MinioStorageService.name);
  private s3Client: S3Client;
  private bucket: string;

  constructor(private configService: ConfigService) {
    const endpoint = this.configService.get<string>(
      "STORAGE_ENDPOINT",
      "http://localhost:9000",
    );
    const accessKeyId = this.configService.get<string>(
      "STORAGE_ACCESS_KEY",
      "minioadmin",
    );
    const secretAccessKey = this.configService.get<string>(
      "STORAGE_SECRET_KEY",
      "minioadmin",
    );
    const region = this.configService.get<string>("STORAGE_REGION", "auto");
    this.bucket = this.configService.get<string>(
      "STORAGE_BUCKET",
      "marketplace-dev",
    );

    this.s3Client = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true, // Necessary for MinIO and local testing
    });
  }

  async isHealthy(): Promise<StorageHealthResult> {
    const start = Date.now();
    try {
      await this.s3Client.send(new ListBucketsCommand({}));
      return {
        status: "ok",
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Storage unreachable";
      this.logger.warn(`Storage health check failed: ${errorMsg}`);
      return {
        status: "error",
        latencyMs: Date.now() - start,
        message: errorMsg,
      };
    }
  }

  async getSignedDownloadUrl(
    key: string,
    ttlSeconds = 300,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.s3Client, command, { expiresIn: ttlSeconds });
  }

  async uploadFile(
    key: string,
    data: Buffer,
    contentType = "application/octet-stream",
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
    });
    await this.s3Client.send(command);
    return key;
  }
}
