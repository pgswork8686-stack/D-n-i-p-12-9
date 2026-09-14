import {
  Injectable,
  Inject,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import {
  IStorageService,
  STORAGE_SERVICE,
} from "../storage/storage.interface";
import { DownloadRateLimiter } from "./download-rate-limiter";
import {
  createProductVersion,
  listProductVersions,
  getProductVersionById,
  addVersionFile,
  publishProductVersion,
  authorizeCustomerDownload,
  authorizeLicenseUpdater,
  recordDownloadEvent,
  DownloadVersionEngineError,
} from "@nexus/database";
import {
  ProductVersionDto,
  ProductVersionFileDto,
  PublishVersionResponse,
  DownloadUrlResponse,
  CheckUpdateResponse,
  DOWNLOAD_SIGNED_URL_DEFAULT_TTL,
} from "@nexus/contracts";
import {
  CreateProductVersionDto,
  AddVersionFileDto,
  RequestDownloadDto,
  CheckUpdateDto,
} from "./dto/downloads.dto";

@Injectable()
export class DownloadsService {
  private readonly logger = new Logger(DownloadsService.name);
  private readonly defaultTtl: number;

  constructor(
    @Inject(STORAGE_SERVICE) private readonly storageService: IStorageService,
    private readonly rateLimiter: DownloadRateLimiter,
    private readonly configService: ConfigService,
  ) {
    this.defaultTtl = Number(
      this.configService.get<string>(
        "DOWNLOAD_SIGNED_URL_TTL_SECONDS",
        String(DOWNLOAD_SIGNED_URL_DEFAULT_TTL),
      ),
    );
  }

  // ----------------------------------------------------
  // ADMIN VERSION MANAGEMENT
  // ----------------------------------------------------

  async createVersion(
    productId: string,
    dto: CreateProductVersionDto,
    actorId: string,
  ): Promise<ProductVersionDto> {
    try {
      return await createProductVersion({
        productId,
        version: dto.version,
        releaseNotes: dto.releaseNotes,
        actorId,
      });
    } catch (err: any) {
      this.handleDomainError(err);
    }
  }

  async listVersions(productId: string): Promise<ProductVersionDto[]> {
    try {
      return await listProductVersions(productId);
    } catch (err: any) {
      this.handleDomainError(err);
    }
  }

  async getVersion(id: string): Promise<ProductVersionDto> {
    try {
      return await getProductVersionById(id);
    } catch (err: any) {
      this.handleDomainError(err);
    }
  }

  async addFile(
    versionId: string,
    dto: AddVersionFileDto,
    actorId: string,
  ): Promise<ProductVersionFileDto> {
    try {
      const version = await getProductVersionById(versionId);

      // Sanitize fileName to prevent directory traversal
      const safeFileName = dto.fileName.replace(/[/\\?%*:|"<>]/g, "_").trim();
      if (!safeFileName) {
        throw new HttpException("Invalid file name", HttpStatus.BAD_REQUEST);
      }

      // Generate authoritative storageKey if not provided
      const storageKey =
        dto.storageKey ||
        `products/${version.productId}/versions/${versionId}/${crypto.randomUUID()}-${safeFileName}`;

      // Verify object existence in private storage
      const meta = await this.storageService.headObject(storageKey);
      if (!meta) {
        throw new HttpException(
          `File object does not exist in storage: '${storageKey}'`,
          HttpStatus.BAD_REQUEST,
        );
      }

      // Verify or calculate authoritative SHA-256 and sizeBytes via streaming
      const verification = await this.storageService.verifyObjectIntegrity(
        storageKey,
        dto.sha256,
        dto.sizeBytes,
      );

      if (!verification.valid) {
        throw new HttpException(
          "File integrity verification failed (SHA-256 or size mismatch)",
          HttpStatus.BAD_REQUEST,
        );
      }

      return await addVersionFile({
        productVersionId: versionId,
        storageKey,
        fileName: safeFileName,
        contentType: dto.contentType || meta.contentType || "application/zip",
        sizeBytes: verification.actualSizeBytes,
        sha256: verification.actualSha256,
        actorId,
        verifiedAt: new Date(),
      });
    } catch (err: any) {
      this.handleDomainError(err);
    }
  }

  async publishVersion(
    versionId: string,
    actorId: string,
  ): Promise<PublishVersionResponse> {
    try {
      return await publishProductVersion({
        productVersionId: versionId,
        actorId,
      });
    } catch (err: any) {
      this.handleDomainError(err);
    }
  }

  // ----------------------------------------------------
  // CUSTOMER DOWNLOADS
  // ----------------------------------------------------

  async requestDownload(
    userId: string,
    dto: RequestDownloadDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<DownloadUrlResponse> {
    // 1. Redis atomic rate limit (fails closed with 503 if Redis is unavailable)
    await this.rateLimiter.checkAndConsumeRateLimit(userId, dto.entitlementId);

    // 2. Authorize via domain engine
    let authContext: any;
    try {
      authContext = await authorizeCustomerDownload({
        userId,
        entitlementId: dto.entitlementId,
        versionId: dto.versionId,
        fileId: dto.fileId,
      });
    } catch (err: any) {
      this.handleDomainError(err);
    }

    const { entitlement, version, file } = authContext;

    // 3. Generate short-lived signed URL
    const downloadUrl = await this.storageService.createSignedDownloadUrl(
      file.storageKey,
      {
        filename: file.fileName,
        ttlSeconds: this.defaultTtl,
      },
    );

    // 4. Record download event (without saving signed URL or secrets)
    await recordDownloadEvent({
      userId,
      entitlementId: entitlement.id,
      productId: version.productId,
      productVersionId: version.id,
      fileId: file.id,
      channel: "CUSTOMER_PORTAL",
      ipAddress,
      userAgent,
    });

    return {
      downloadUrl,
      fileName: file.fileName,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      expiresIn: this.defaultTtl,
    };
  }

  // ----------------------------------------------------
  // LICENSE UPDATER CHECK
  // ----------------------------------------------------

  async checkUpdate(
    dto: CheckUpdateDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<CheckUpdateResponse> {
    const result = await authorizeLicenseUpdater({
      licenseKey: dto.licenseKey,
      domain: dto.domain,
      productId: dto.productId,
      currentVersion: dto.currentVersion,
    });

    if (!result.valid || !result.updateAvailable || !result.file || !result.eligibleVersion) {
      return {
        valid: result.valid,
        updateAvailable: false,
      };
    }

    // Generate short-lived signed URL for updater
    const downloadUrl = await this.storageService.createSignedDownloadUrl(
      result.file.storageKey,
      {
        filename: result.file.fileName,
        ttlSeconds: this.defaultTtl,
      },
    );

    // Record download event
    if (result.entitlementId) {
      await recordDownloadEvent({
        userId: result.userId || null,
        entitlementId: result.entitlementId,
        productId: dto.productId,
        productVersionId: result.eligibleVersion.id,
        fileId: result.file.id,
        channel: "LICENSE_UPDATER",
        ipAddress,
        userAgent,
      });
    }

    return {
      valid: true,
      updateAvailable: true,
      version: result.eligibleVersion.version,
      releasedAt: result.eligibleVersion.releasedAt
        ? result.eligibleVersion.releasedAt.toISOString()
        : null,
      releaseNotes: result.eligibleVersion.releaseNotes,
      sha256: result.file.sha256,
      sizeBytes: result.file.sizeBytes,
      downloadUrl,
    };
  }

  // ----------------------------------------------------
  // ERROR HANDLING HELPER
  // ----------------------------------------------------

  private handleDomainError(err: any): never {
    if (err instanceof HttpException) {
      throw err;
    }
    if (err instanceof DownloadVersionEngineError) {
      throw new HttpException(err.message, err.statusCode);
    }
    this.logger.error(`Unexpected download engine error: ${err?.message || err}`);
    throw new HttpException("Internal server error", HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
