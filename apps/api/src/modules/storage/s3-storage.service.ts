import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  S3Client,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { IStorageService, StorageHealthResult } from "./storage.interface";

@Injectable()
export class S3CompatibleStorageService implements IStorageService {
  private readonly logger = new Logger(S3CompatibleStorageService.name);
  private s3Client: S3Client;
  private bucket: string;
  private provider: string;

  constructor(private configService: ConfigService) {
    this.provider = this.configService
      .get<string>("STORAGE_PROVIDER", "minio")
      .toLowerCase();

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

    // MinIO and local endpoints need forcePathStyle: true
    // Cloudflare R2 / AWS S3 can use virtual hosted or path style
    const forcePathStyle =
      this.provider === "minio" ||
      endpoint.includes("localhost") ||
      endpoint.includes("127.0.0.1");

    this.s3Client = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle,
    });
  }

  async isHealthy(): Promise<StorageHealthResult> {
    const start = Date.now();
    try {
      // 1. First probe configured bucket specifically (supports restricted bucket-scoped credentials)
      await this.s3Client.send(
        new HeadBucketCommand({
          Bucket: this.bucket,
        }),
      );
      return {
        status: "ok",
        latencyMs: Date.now() - start,
      };
    } catch (headErr) {
      // 2. Fallback: probe by listing 1 object in bucket
      try {
        await this.s3Client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            MaxKeys: 1,
          }),
        );
        return {
          status: "ok",
          latencyMs: Date.now() - start,
        };
      } catch (listErr) {
        const errorMsg =
          headErr instanceof Error ? headErr.message : "Storage unreachable";
        this.logger.warn(
          `Storage health probe failed for bucket '${this.bucket}' (provider: ${this.provider}): ${errorMsg}`,
        );
        return {
          status: "error",
          latencyMs: Date.now() - start,
          message: errorMsg,
        };
      }
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
