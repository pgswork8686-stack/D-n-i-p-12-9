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
  prisma,
  createProductVersion,
  listProductVersions,
  getProductVersionById,
  addVersionFile,
  publishProductVersion,
  issueCustomerDownloadGrant,
  issueUpdaterDownloadGrant,
  sanitizeFilename,
  generateStorageKey,
  DownloadVersionEngineError,
} from "@nexus/database";
import {
  normalizeDomain,
  normalizeLicenseKey,
  hashLicenseKey,
} from "@nexus/utils";
import {
  ProductVersionDto,
  ProductVersionFileDto,
  PublishVersionResponse,
  DownloadUrlResponse,
  CheckUpdateResponse,
  DOWNLOAD_SIGNED_URL_DEFAULT_TTL,
  resolveDownloadTtl,
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
    // Client cannot supply arbitrary storageKey
    if ((dto as any).storageKey) {
      throw new HttpException(
        "Client-specified storageKey is forbidden. Storage keys are backend-generated.",
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const version = await getProductVersionById(versionId);
      const safeFileName = sanitizeFilename(dto.fileName);
      const storageKey = generateStorageKey(version.productId, versionId, safeFileName);

      // Verify object exists in private storage
      const meta = await this.storageService.headObject(storageKey);
      if (!meta) {
        throw new HttpException(
          `File object does not exist in storage: '${storageKey}'`,
          HttpStatus.BAD_REQUEST,
        );
      }

      // Authoritatively verify SHA-256 and sizeBytes
      const verification = await this.storageService.verifyObjectIntegrity(storageKey);
      if (!verification.valid) {
        throw new HttpException(
          "File integrity verification failed (storage verification mismatch)",
          HttpStatus.BAD_REQUEST,
        );
      }

      return await addVersionFile({
        productVersionId: versionId,
        fileName: safeFileName,
        contentType: dto.contentType || meta.contentType || "application/zip",
        sizeBytes: verification.actualSizeBytes,
        sha256: verification.actualSha256,
        isPrimary: dto.isPrimary ?? false,
        storageKey,
        actorId,
        verifiedAt: new Date(),
      });
    } catch (err: any) {
      this.handleDomainError(err);
    }
  }

  /**
   * Authoritative backend multipart file upload.
   * Admin streams file directly to backend, which uploads to private storage,
   * derives authoritative SHA-256 and sizeBytes, verifies object, and registers ProductVersionFile.
   */
  async uploadFile(
    versionId: string,
    file: { originalname: string; buffer: Buffer; mimetype?: string; size: number },
    isPrimary: boolean,
    actorId: string,
  ): Promise<ProductVersionFileDto> {
    if (!file || !file.buffer) {
      throw new HttpException("Missing file payload", HttpStatus.BAD_REQUEST);
    }

    try {
      const version = await getProductVersionById(versionId);
      if (version.status === "PUBLISHED") {
        throw new HttpException(
          "Published version is immutable; cannot add files",
          HttpStatus.CONFLICT,
        );
      }

      const safeFileName = sanitizeFilename(file.originalname);
      const storageKey = generateStorageKey(version.productId, versionId, safeFileName);

      // Authoritative SHA-256 and sizeBytes from buffer
      const actualSha256 = crypto.createHash("sha256").update(file.buffer).digest("hex");
      const actualSizeBytes = file.buffer.length;

      // Upload to private storage
      await this.storageService.uploadFile(
        storageKey,
        file.buffer,
        file.mimetype || "application/zip",
      );

      // Verify uploaded object
      const verification = await this.storageService.verifyObjectIntegrity(
        storageKey,
        actualSha256,
        actualSizeBytes,
      );
      if (!verification.valid) {
        throw new HttpException(
          "Uploaded file integrity verification failed in storage",
          HttpStatus.BAD_REQUEST,
        );
      }

      return await addVersionFile({
        productVersionId: versionId,
        fileName: safeFileName,
        contentType: file.mimetype || "application/zip",
        sizeBytes: actualSizeBytes,
        sha256: actualSha256,
        isPrimary,
        storageKey,
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
        verifyFileIntegrity: async (file) => {
          const meta = await this.storageService.headObject(file.storageKey);
          if (!meta) {
            return { valid: false, reason: `Object '${file.storageKey}' not found in storage` };
          }
          const integrity = await this.storageService.verifyObjectIntegrity(
            file.storageKey,
            file.sha256,
            file.sizeBytes,
          );
          return {
            valid: integrity.valid,
            reason: integrity.valid
              ? undefined
              : `Integrity mismatch for file '${file.fileName}': expected size=${file.sizeBytes}, sha=${file.sha256}, got size=${integrity.actualSizeBytes}, sha=${integrity.actualSha256}`,
          };
        },
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
    // 1. Lightweight preflight resolution to prevent arbitrary UUID rate limit key spam
    const preflightEntitlement = await prisma.entitlement.findUnique({
      where: { id: dto.entitlementId },
    });
    if (!preflightEntitlement || preflightEntitlement.userId !== userId) {
      throw new HttpException("Access forbidden to entitlement", HttpStatus.FORBIDDEN);
    }

    // 2. Redis atomic sliding-window rate limit (fails closed with 503 if Redis unavailable)
    await this.rateLimiter.checkAndConsumeCustomerRateLimit(userId, dto.entitlementId);

    // 3. Issue authoritative DownloadGrant in row-locked transaction (linearization point)
    let grantResult: any;
    try {
      grantResult = await issueCustomerDownloadGrant({
        userId,
        entitlementId: dto.entitlementId,
        versionId: dto.versionId,
        fileId: dto.fileId,
        ttlSeconds: this.defaultTtl,
        ipAddress,
        userAgent,
      });
    } catch (err: any) {
      this.handleDomainError(err);
    }

    const { file } = grantResult;

    // 4. Verify storage object still exists before generating signed URL
    const meta = await this.storageService.headObject(file.storageKey);
    if (!meta) {
      this.logger.error(`Download object missing in storage: '${file.storageKey}'`);
      throw new HttpException(
        "Download asset currently unavailable. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // 5. Generate short-lived signed URL with clamped TTL
    const effectiveTtl = resolveDownloadTtl(this.defaultTtl);
    const downloadUrl = await this.storageService.createSignedDownloadUrl(
      file.storageKey,
      {
        filename: file.fileName,
        ttlSeconds: effectiveTtl,
      },
    );

    return {
      downloadUrl,
      fileName: file.fileName,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      expiresIn: effectiveTtl,
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
    // 1. Lightweight license & domain preflight
    let normalizedKey: string;
    let normalizedDom: string;
    try {
      normalizedKey = normalizeLicenseKey(dto.licenseKey);
      normalizedDom = normalizeDomain(dto.domain);
    } catch {
      return { valid: false, updateAvailable: false };
    }

    const hashedKey = hashLicenseKey(normalizedKey);
    const preflightLic = await prisma.internalLicense.findUnique({
      where: { keyHash: hashedKey },
    });
    if (!preflightLic || preflightLic.status !== "ACTIVE") {
      return { valid: false, updateAvailable: false };
    }

    // 2. Rate limit updater by entitlementId + normalizedDomain
    try {
      await this.rateLimiter.checkAndConsumeUpdaterRateLimit(
        preflightLic.entitlementId,
        normalizedDom,
      );
    } catch (rlErr: any) {
      if (rlErr?.status === HttpStatus.SERVICE_UNAVAILABLE) {
        throw rlErr;
      }
      return { valid: true, updateAvailable: false };
    }

    // 3. Issue updater grant under consistent DB lock order
    const result = await issueUpdaterDownloadGrant({
      licenseKey: dto.licenseKey,
      domain: dto.domain,
      productId: dto.productId,
      currentVersion: dto.currentVersion,
      ttlSeconds: this.defaultTtl,
      ipAddress,
      userAgent,
    });

    if (!result.valid || !result.updateAvailable || !result.file || !result.version) {
      return {
        valid: result.valid,
        updateAvailable: false,
      };
    }

    // 4. Verify storage object exists before signing URL
    const meta = await this.storageService.headObject(result.file.storageKey);
    if (!meta) {
      this.logger.error(`Updater package missing in storage: '${result.file.storageKey}'`);
      return {
        valid: true,
        updateAvailable: false,
      };
    }

    // 5. Generate short-lived signed URL with clamped TTL
    const effectiveTtl = resolveDownloadTtl(this.defaultTtl);
    const downloadUrl = await this.storageService.createSignedDownloadUrl(
      result.file.storageKey,
      {
        filename: result.file.fileName,
        ttlSeconds: effectiveTtl,
      },
    );

    return {
      valid: true,
      updateAvailable: true,
      version: result.version.version,
      releasedAt: result.version.releasedAt
        ? result.version.releasedAt.toISOString()
        : null,
      releaseNotes: result.version.releaseNotes,
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
