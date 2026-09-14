import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  S3Client,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import * as crypto from "crypto";
import { Readable } from "stream";
import {
  IStorageService,
  StorageHealthResult,
  StorageObjectMetadata,
  StorageIntegrityVerificationResult,
  SignedDownloadUrlOptions,
} from "./storage.interface";
import {
  resolveDownloadTtl,
} from "@nexus/contracts";

@Injectable()
export class S3CompatibleStorageService implements IStorageService {
  private readonly logger = new Logger(S3CompatibleStorageService.name);
  private s3Client: S3Client;
  private bucket: string;
  private provider: string;

  constructor(private configService: ConfigService) {
    const isProduction =
      this.configService.get<string>("NODE_ENV") === "production";

    if (isProduction) {
      const requiredVars = [
        "STORAGE_PROVIDER",
        "STORAGE_ENDPOINT",
        "STORAGE_BUCKET",
        "STORAGE_ACCESS_KEY",
        "STORAGE_SECRET_KEY",
      ];
      for (const varName of requiredVars) {
        const val = this.configService.get<string>(varName);
        if (!val || val.trim() === "") {
          throw new Error(
            `[Storage] Production configuration missing required environment variable: ${varName}`,
          );
        }
      }
    }

    this.provider = (
      this.configService.get<string>("STORAGE_PROVIDER") || "minio"
    ).toLowerCase();

    const endpoint =
      this.configService.get<string>("STORAGE_ENDPOINT") ||
      "http://localhost:9000";
    const accessKeyId =
      this.configService.get<string>("STORAGE_ACCESS_KEY") || "minioadmin";
    const secretAccessKey =
      this.configService.get<string>("STORAGE_SECRET_KEY") || "minioadmin";
    const region = this.configService.get<string>("STORAGE_REGION") || "auto";
    this.bucket =
      this.configService.get<string>("STORAGE_BUCKET") || "marketplace-dev";

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
      } catch (_listErr) {
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
    ttlSeconds?: number,
  ): Promise<string> {
    return this.createSignedDownloadUrl(key, { ttlSeconds });
  }

  async createSignedDownloadUrl(
    key: string,
    options?: SignedDownloadUrlOptions,
  ): Promise<string> {
    const ttl = resolveDownloadTtl(options?.ttlSeconds);

    let responseContentDisposition: string | undefined;
    if (options?.filename) {
      const sanitized = options.filename
        .replace(/[/\\?%*:|"<>]/g, "_")
        .replace(/[\r\n]/g, "")
        .trim();
      if (sanitized) {
        responseContentDisposition = `attachment; filename="${sanitized}"`;
      }
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: responseContentDisposition,
    });

    return getSignedUrl(this.s3Client, command, { expiresIn: ttl });
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

  async headObject(key: string): Promise<StorageObjectMetadata | null> {
    try {
      const res = await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return {
        contentLength: res.ContentLength ?? 0,
        contentType: res.ContentType,
        etag: res.ETag,
        lastModified: res.LastModified,
      };
    } catch (err: any) {
      if (
        err?.name === "NotFound" ||
        err?.name === "NoSuchKey" ||
        err?.$metadata?.httpStatusCode === 404
      ) {
        return null;
      }
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  async verifyObjectIntegrity(
    key: string,
    expectedSha256?: string,
    expectedSizeBytes?: number,
  ): Promise<StorageIntegrityVerificationResult> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const res = await this.s3Client.send(command);
    const stream = res.Body as Readable;
    if (!stream) {
      throw new Error(`Object body empty or invalid stream for key '${key}'`);
    }

    const hash = crypto.createHash("sha256");
    let totalBytes = 0;

    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        hash.update(chunk);
      });
      stream.on("end", () => resolve());
      stream.on("error", (err) => reject(err));
    });

    const actualSha256 = hash.digest("hex");
    let valid = true;

    if (expectedSha256 && actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
      valid = false;
    }
    if (expectedSizeBytes !== undefined && totalBytes !== expectedSizeBytes) {
      valid = false;
    }

    return {
      valid,
      actualSha256,
      actualSizeBytes: totalBytes,
    };
  }
}
