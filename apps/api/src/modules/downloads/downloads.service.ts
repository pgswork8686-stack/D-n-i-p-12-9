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
  recordDownloadIssuance,
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

  /**
   * Authoritative backend multipart file upload.
   * Admin streams file directly to backend, which uploads to private storage,
   * derives authoritative SHA-256 and sizeBytes, verifies object, and registers ProductVersionFile.
   * If downstream verification, database registration, or audit logging fails,
   * any newly uploaded storage object is cleaned up to prevent orphaned assets.
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

    const maxUploadBytes = process.env.MAX_UPLOAD_BYTES
      ? parseInt(process.env.MAX_UPLOAD_BYTES, 10)
      : 50 * 1024 * 1024;
    if (file.buffer.length > maxUploadBytes) {
      throw new HttpException("File payload too large", HttpStatus.PAYLOAD_TOO_LARGE);
    }

    let uploadedStorageKey: string | null = null;
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
      uploadedStorageKey = storageKey;

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
      if (uploadedStorageKey) {
        try {
          await this.storageService.deleteObject(uploadedStorageKey);
          this.logger.log(`Cleaned up orphaned storage object on upload failure: ${uploadedStorageKey}`);
        } catch (cleanupErr) {
          this.logger.warn(`Failed to clean up orphaned storage object: ${uploadedStorageKey}`);
        }
      }
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

    // 3. STEP A: Issue authoritative DownloadGrant in row-locked transaction (linearization point)
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

    const { grant, file } = grantResult;

    // 4. STEP B: Verify storage object still exists and create signed URL
    // If this step fails, NO DownloadEvent and NO DOWNLOAD_URL_ISSUED audit log are created.
    let downloadUrl: string;
    const effectiveTtl = resolveDownloadTtl(this.defaultTtl);
    try {
      const meta = await this.storageService.headObject(file.storageKey);
      if (!meta) {
        this.logger.error(`Download object missing in storage: '${file.storageKey}'`);
        throw new HttpException(
          "Download asset currently unavailable. Please try again later.",
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      downloadUrl = await this.storageService.createSignedDownloadUrl(
        file.storageKey,
        {
          filename: file.fileName,
          ttlSeconds: effectiveTtl,
        },
      );
    } catch (storageErr: any) {
      if (storageErr instanceof HttpException) throw storageErr;
      this.logger.error(`Storage presigning failed: ${storageErr?.message || storageErr}`);
      throw new HttpException(
        "Download signing currently unavailable. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // 5. STEP C: Record issuance transaction (DownloadEvent + AuditLog) strictly after URL is generated
    try {
      await recordDownloadIssuance({
        grantId: grant.id,
        ipAddress,
        userAgent,
      });
    } catch (recordErr: any) {
      this.logger.error(`Failed to record download issuance: ${recordErr?.message || recordErr}`);
      throw new HttpException(
        "Download service temporarily unavailable. Please try again later.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

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
    // 1. Lightweight license & domain preflight (requires ACTIVE license AND ACTIVE activation for domain)
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
      include: {
        activations: {
          where: {
            normalizedDomain: normalizedDom,
            status: "ACTIVE",
          },
        },
      },
    });
    if (!preflightLic || preflightLic.status !== "ACTIVE" || preflightLic.activations.length === 0) {
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

    // 3. STEP A: Issue updater grant under consistent DB lock order (linearization point)
    const result = await issueUpdaterDownloadGrant({
      licenseKey: dto.licenseKey,
      domain: dto.domain,
      productId: dto.productId,
      currentVersion: dto.currentVersion,
      ttlSeconds: this.defaultTtl,
      ipAddress,
      userAgent,
    });

    if (!result.valid || !result.updateAvailable || !result.grant || !result.file || !result.version) {
      return {
        valid: result.valid,
        updateAvailable: false,
      };
    }

    // 4. STEP B: Verify storage object exists and generate signed URL
    let downloadUrl: string;
    const effectiveTtl = resolveDownloadTtl(this.defaultTtl);
    try {
      const meta = await this.storageService.headObject(result.file.storageKey);
      if (!meta) {
        this.logger.error(`Updater package missing in storage: '${result.file.storageKey}'`);
        return {
          valid: true,
          updateAvailable: false,
        };
      }

      downloadUrl = await this.storageService.createSignedDownloadUrl(
        result.file.storageKey,
        {
          filename: result.file.fileName,
          ttlSeconds: effectiveTtl,
        },
      );
    } catch (storageErr: any) {
      this.logger.error(`Updater presigning failed: ${storageErr?.message || storageErr}`);
      return {
        valid: true,
        updateAvailable: false,
      };
    }

    // 5. STEP C: Record issuance transaction strictly after URL is successfully generated
    try {
      await recordDownloadIssuance({
        grantId: result.grant.id,
        ipAddress,
        userAgent,
      });
    } catch (recordErr: any) {
      this.logger.error(`Failed to record updater download issuance: ${recordErr?.message || recordErr}`);
      return {
        valid: true,
        updateAvailable: false,
      };
    }

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
