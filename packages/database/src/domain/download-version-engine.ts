import { PrismaClient, ProductVersion, ProductVersionFile } from "@prisma/client";
import { prisma as defaultPrisma } from "../client";
import * as crypto from "crypto";
import {
  isValidSemver,
  cleanSemver,
  isSemverGreater,
  sortSemverDescending,
  normalizeDomain,
  normalizeLicenseKey,
  hashLicenseKey,
} from "@nexus/utils";
import {
  ProductVersionDto,
  ProductVersionFileDto,
  PublishVersionResponse,
  VersionStatus,
  DownloadChannel,
} from "@nexus/contracts";

export class DownloadVersionEngineError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
    public code = "DOWNLOAD_VERSION_ERROR",
  ) {
    super(message);
    this.name = "DownloadVersionEngineError";
  }
}

/**
 * Maps ProductVersion Prisma model to ProductVersionDto.
 */
export function mapProductVersionToDto(
  v: ProductVersion & { files?: ProductVersionFile[] },
): ProductVersionDto {
  return {
    id: v.id,
    productId: v.productId,
    version: v.version,
    status: v.status as VersionStatus,
    releaseNotes: v.releaseNotes,
    releasedAt: v.releasedAt ? v.releasedAt.toISOString() : null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    files: v.files?.map(mapProductVersionFileToDto),
  };
}

/**
 * Maps ProductVersionFile Prisma model to ProductVersionFileDto.
 */
export function mapProductVersionFileToDto(
  f: ProductVersionFile,
): ProductVersionFileDto {
  return {
    id: f.id,
    productVersionId: f.productVersionId,
    storageKey: f.storageKey,
    fileName: f.fileName,
    contentType: f.contentType,
    sizeBytes: f.sizeBytes,
    sha256: f.sha256,
    verifiedAt: f.verifiedAt ? f.verifiedAt.toISOString() : null,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

/**
 * Authoritative check for whether a product version is eligible for a customer
 * based on the entitlement's updatesUntil timestamp.
 *
 * Invariants:
 * 1. If updatesUntil is null: no version cutoff while Entitlement is active. Returns true.
 * 2. If updatesUntil is present: version is downloadable only when version.releasedAt <= updatesUntil.
 * 3. Customers whose update window expired can still download versions released during their purchased window.
 */
export function checkVersionEligibility(
  versionReleasedAt: Date | null,
  updatesUntil: Date | null,
): boolean {
  if (updatesUntil === null) {
    return true;
  }
  if (!versionReleasedAt) {
    return false;
  }
  return versionReleasedAt.getTime() <= updatesUntil.getTime();
}

/**
 * Admin: Create a new DRAFT ProductVersion.
 */
export async function createProductVersion(
  params: {
    productId: string;
    version: string;
    releaseNotes?: string;
    actorId: string;
  },
  db: PrismaClient = defaultPrisma,
): Promise<ProductVersionDto> {
  const { productId, version, releaseNotes, actorId } = params;

  // 1. Verify product exists
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) {
    throw new DownloadVersionEngineError("Product not found", 404);
  }

  // 2. Validate SemVer format
  if (!isValidSemver(version)) {
    throw new DownloadVersionEngineError(
      `Invalid semantic version '${version}'. Must follow SemVer 2.0.0 (e.g. 1.0.0, 2.1.3-beta.1)`,
      400,
    );
  }
  const cleanedVersion = cleanSemver(version);

  // 3. Check uniqueness for (productId, version)
  const existing = await db.productVersion.findUnique({
    where: {
      productId_version: {
        productId,
        version: cleanedVersion,
      },
    },
  });
  if (existing) {
    throw new DownloadVersionEngineError(
      `Version '${cleanedVersion}' already exists for this product`,
      409,
    );
  }

  // 4. Create version in DRAFT status
  try {
    const created = await db.$transaction(async (tx) => {
      const v = await tx.productVersion.create({
        data: {
          productId,
          version: cleanedVersion,
          status: "DRAFT",
          releaseNotes: releaseNotes?.trim() || null,
        },
        include: { files: true },
      });

      await tx.auditLog.create({
        data: {
          action: "VERSION_CREATED",
          entity: "ProductVersion",
          entityId: v.id,
          actorId,
          details: {
            productId,
            version: cleanedVersion,
            status: "DRAFT",
          },
        },
      });

      return v;
    });

    return mapProductVersionToDto(created);
  } catch (err: any) {
    if (err?.code === "P2002") {
      throw new DownloadVersionEngineError(
        `Version '${cleanedVersion}' already exists for this product`,
        409,
      );
    }
    throw err;
  }
}

/**
 * Admin: List versions for a product.
 */
export async function listProductVersions(
  productId: string,
  db: PrismaClient = defaultPrisma,
): Promise<ProductVersionDto[]> {
  const versions = await db.productVersion.findMany({
    where: { productId },
    include: { files: true },
  });

  const sorted = sortSemverDescending(versions);
  return sorted.map(mapProductVersionToDto);
}

/**
 * Admin: Get version by ID.
 */
export async function getProductVersionById(
  id: string,
  db: PrismaClient = defaultPrisma,
): Promise<ProductVersionDto> {
  const version = await db.productVersion.findUnique({
    where: { id },
    include: { files: true },
  });
  if (!version) {
    throw new DownloadVersionEngineError("Product version not found", 404);
  }
  return mapProductVersionToDto(version);
}

/**
 * Admin: Add verified file to version.
 * Published versions are strictly immutable.
 */
export async function addVersionFile(
  params: {
    productVersionId: string;
    storageKey: string;
    fileName: string;
    contentType?: string;
    sizeBytes: number;
    sha256: string;
    actorId: string;
    verifiedAt?: Date;
  },
  db: PrismaClient = defaultPrisma,
): Promise<ProductVersionFileDto> {
  const {
    productVersionId,
    storageKey,
    fileName,
    contentType = "application/zip",
    sizeBytes,
    sha256,
    actorId,
    verifiedAt = new Date(),
  } = params;

  if (!storageKey || !fileName || sizeBytes <= 0 || !sha256) {
    throw new DownloadVersionEngineError("Invalid file metadata", 400);
  }

  try {
    const file = await db.$transaction(async (tx) => {
      const vRows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM product_versions WHERE id = ${productVersionId} FOR UPDATE
      `;
      if (!vRows || vRows.length === 0) {
        throw new DownloadVersionEngineError("Product version not found", 404);
      }
      const versionRow = vRows[0];

      // Immutable published check
      if (versionRow.status === "PUBLISHED") {
        throw new DownloadVersionEngineError(
          "Published version is immutable; cannot add or modify files",
          409,
        );
      }

      // Check storageKey uniqueness
      const existingKey = await tx.productVersionFile.findUnique({
        where: { storageKey },
      });
      if (existingKey) {
        throw new DownloadVersionEngineError(
          `Storage key '${storageKey}' is already associated with another file`,
          409,
        );
      }

      const newFile = await tx.productVersionFile.create({
        data: {
          productVersionId,
          storageKey,
          fileName: fileName.trim(),
          contentType,
          sizeBytes,
          sha256: sha256.toLowerCase().trim(),
          verifiedAt,
        },
      });

      await tx.auditLog.create({
        data: {
          action: "VERSION_FILE_VERIFIED",
          entity: "ProductVersionFile",
          entityId: newFile.id,
          actorId,
          details: {
            productVersionId,
            storageKey,
            fileName: newFile.fileName,
            sizeBytes,
            sha256: newFile.sha256,
          },
        },
      });

      return newFile;
    });

    return mapProductVersionFileToDto(file);
  } catch (err: any) {
    if (err?.code === "P2002") {
      throw new DownloadVersionEngineError(
        `Storage key '${storageKey}' is already associated with another file`,
        409,
      );
    }
    throw err;
  }
}

/**
 * Admin: Publish DRAFT version.
 * Atomic CAS transition: DRAFT -> PUBLISHED.
 * Exactly 1 VERSION_PUBLISHED audit log created under concurrent races.
 */
export async function publishProductVersion(
  params: {
    productVersionId: string;
    actorId: string;
  },
  db: PrismaClient = defaultPrisma,
): Promise<PublishVersionResponse> {
  const { productVersionId, actorId } = params;

  const result = await db.$transaction(async (tx) => {
    // Acquire exclusive row lock
    const vRows = await tx.$queryRaw<
      Array<{
        id: string;
        product_id: string;
        version: string;
        status: string;
        released_at: Date | null;
      }>
    >`
      SELECT id, product_id, version, status, released_at
      FROM product_versions
      WHERE id = ${productVersionId}
      FOR UPDATE
    `;

    if (!vRows || vRows.length === 0) {
      throw new DownloadVersionEngineError("Product version not found", 404);
    }
    const current = vRows[0];

    // Idempotent return if already published (zero duplicate audit logs)
    if (current.status === "PUBLISHED") {
      const full = await tx.productVersion.findUnique({
        where: { id: productVersionId },
        include: { files: true },
      });
      return {
        success: true,
        version: mapProductVersionToDto(full!),
      };
    }

    // Must have at least 1 verified file
    const verifiedFiles = await tx.productVersionFile.findMany({
      where: {
        productVersionId,
        verifiedAt: { not: null },
      },
    });

    if (verifiedFiles.length === 0) {
      throw new DownloadVersionEngineError(
        "Cannot publish version without at least one verified file",
        400,
      );
    }

    const now = new Date();
    const updated = await tx.productVersion.update({
      where: { id: productVersionId },
      data: {
        status: "PUBLISHED",
        releasedAt: now,
      },
      include: { files: true },
    });

    // Record VERSION_PUBLISHED audit log (strictly once)
    await tx.auditLog.create({
      data: {
        action: "VERSION_PUBLISHED",
        entity: "ProductVersion",
        entityId: productVersionId,
        actorId,
        details: {
          productId: current.product_id,
          version: current.version,
          fileCount: verifiedFiles.length,
          releasedAt: now.toISOString(),
        },
      },
    });

    return {
      success: true,
      version: mapProductVersionToDto(updated),
    };
  });

  return result;
}

/**
 * Authorize Customer Download Request.
 * Verifies:
 * - Entitlement ownership and active status
 * - Expiration check (clock-based fail-closed)
 * - Fulfillment type (DIGITAL_DOWNLOAD or INTERNAL_LICENSE)
 * - Product/Version/File integrity
 * - Version is PUBLISHED
 * - Version releasedAt <= entitlement.updatesUntil
 */
export async function authorizeCustomerDownload(
  params: {
    userId: string;
    entitlementId: string;
    versionId: string;
    fileId: string;
  },
  db: PrismaClient = defaultPrisma,
): Promise<{
  entitlement: any;
  version: ProductVersion;
  file: ProductVersionFile;
}> {
  const { userId, entitlementId, versionId, fileId } = params;

  // 1. Fetch entitlement
  const entitlement = await db.entitlement.findUnique({
    where: { id: entitlementId },
  });

  if (!entitlement) {
    throw new DownloadVersionEngineError("Entitlement not found", 404);
  }

  // Cross-user isolation
  if (entitlement.userId !== userId) {
    throw new DownloadVersionEngineError("Access forbidden to entitlement", 403);
  }

  // Status checks
  if (entitlement.status === "REVOKED") {
    throw new DownloadVersionEngineError(
      "Entitlement has been revoked",
      409,
      "ENTITLEMENT_REVOKED",
    );
  }
  if (entitlement.status === "EXPIRED") {
    throw new DownloadVersionEngineError(
      "Entitlement has expired",
      409,
      "ENTITLEMENT_EXPIRED",
    );
  }
  if (entitlement.status !== "ACTIVE") {
    throw new DownloadVersionEngineError("Entitlement is not active", 409);
  }

  // Clock-based expiry check (fail closed immediately even before worker catches up)
  if (entitlement.expiresAt && entitlement.expiresAt.getTime() <= Date.now()) {
    throw new DownloadVersionEngineError(
      "Entitlement has expired",
      409,
      "ENTITLEMENT_EXPIRED",
    );
  }

  // Fulfillment type check
  if (
    entitlement.fulfillmentType !== "DIGITAL_DOWNLOAD" &&
    entitlement.fulfillmentType !== "INTERNAL_LICENSE"
  ) {
    throw new DownloadVersionEngineError(
      `Fulfillment strategy '${entitlement.fulfillmentType}' does not grant digital file downloads`,
      400,
    );
  }

  // 2. Fetch version
  const version = await db.productVersion.findUnique({
    where: { id: versionId },
  });
  if (!version) {
    throw new DownloadVersionEngineError("Product version not found", 404);
  }

  // Verify version belongs to entitlement's product
  if (version.productId !== entitlement.productId) {
    throw new DownloadVersionEngineError(
      "Requested version does not belong to the entitled product",
      400,
    );
  }

  // Invariant: Customer can NEVER download DRAFT versions
  if (version.status !== "PUBLISHED") {
    throw new DownloadVersionEngineError(
      "Version is not published",
      403,
      "VERSION_NOT_PUBLISHED",
    );
  }

  // 3. Fetch file
  const file = await db.productVersionFile.findUnique({
    where: { id: fileId },
  });
  if (!file) {
    throw new DownloadVersionEngineError("File not found", 404);
  }

  if (file.productVersionId !== version.id) {
    throw new DownloadVersionEngineError(
      "File does not belong to the requested version",
      400,
    );
  }

  if (!file.verifiedAt) {
    throw new DownloadVersionEngineError("File is unverified", 400);
  }

  // 4. Check update window eligibility
  const eligible = checkVersionEligibility(
    version.releasedAt,
    entitlement.updatesUntil,
  );
  if (!eligible) {
    throw new DownloadVersionEngineError(
      "Version released after your update entitlement cutoff date",
      403,
      "UPDATE_WINDOW_EXPIRED",
    );
  }

  return { entitlement, version, file };
}

/**
 * Authorize Licensed Software / WordPress Updater Check.
 * Generic fail-closed response without leaking license key existence.
 */
export async function authorizeLicenseUpdater(
  params: {
    licenseKey: string;
    domain: string;
    productId: string;
    currentVersion: string;
  },
  db: PrismaClient = defaultPrisma,
): Promise<{
  valid: boolean;
  updateAvailable: boolean;
  eligibleVersion?: ProductVersion;
  file?: ProductVersionFile;
  entitlementId?: string;
  userId?: string;
}> {
  const genericInvalid = { valid: false, updateAvailable: false };

  // 1. Strict syntax validations
  let normalizedKey: string;
  let normalizedDom: string;
  try {
    normalizedKey = normalizeLicenseKey(params.licenseKey);
    normalizedDom = normalizeDomain(params.domain);
  } catch {
    return genericInvalid;
  }

  if (!isValidSemver(params.currentVersion)) {
    return genericInvalid;
  }
  const cleanCurrentVer = cleanSemver(params.currentVersion);

  // 2. Lookup InternalLicense by keyHash
  const hashedKey = hashLicenseKey(normalizedKey);
  const license = await db.internalLicense.findUnique({
    where: { keyHash: hashedKey },
  });

  if (!license || license.status !== "ACTIVE") {
    return genericInvalid;
  }

  // 3. Lookup active domain activation
  const activation = await db.licenseActivation.findFirst({
    where: {
      licenseId: license.id,
      normalizedDomain: normalizedDom,
      status: "ACTIVE",
    },
  });
  if (!activation) {
    return genericInvalid;
  }

  // 4. Lookup Entitlement
  const entitlement = await db.entitlement.findUnique({
    where: { id: license.entitlementId },
  });
  if (!entitlement || entitlement.status !== "ACTIVE") {
    return genericInvalid;
  }

  // Expiration checks
  if (entitlement.expiresAt && entitlement.expiresAt.getTime() <= Date.now()) {
    return genericInvalid;
  }

  // Fulfillment type check
  if (entitlement.fulfillmentType !== "INTERNAL_LICENSE") {
    return genericInvalid;
  }

  // Product match check
  if (entitlement.productId !== params.productId) {
    return genericInvalid;
  }

  // Key is valid and active!
  // 5. Query all published versions for productId with verified files
  const publishedVersions = await db.productVersion.findMany({
    where: {
      productId: params.productId,
      status: "PUBLISHED",
    },
    include: {
      files: {
        where: { verifiedAt: { not: null } },
      },
    },
  });

  // Filter versions with at least 1 verified file and within update window
  const eligibleVersions = publishedVersions.filter((v) => {
    if (v.files.length === 0) return false;
    return checkVersionEligibility(v.releasedAt, entitlement.updatesUntil);
  });

  if (eligibleVersions.length === 0) {
    return { valid: true, updateAvailable: false };
  }

  // Sort eligible versions descending by semver
  const sorted = sortSemverDescending(eligibleVersions);
  const latestEligible = sorted[0];

  // Compare with customer's currentVersion
  if (!isSemverGreater(latestEligible.version, cleanCurrentVer)) {
    return { valid: true, updateAvailable: false };
  }

  // Update is available!
  return {
    valid: true,
    updateAvailable: true,
    eligibleVersion: latestEligible,
    file: latestEligible.files[0],
    entitlementId: entitlement.id,
    userId: entitlement.userId,
  };
}

/**
 * Records a DownloadEvent and an audit log without storing signed URLs or secrets.
 */
export async function recordDownloadEvent(
  params: {
    userId?: string | null;
    entitlementId: string;
    productId: string;
    productVersionId: string;
    fileId: string;
    channel: DownloadChannel;
    ipAddress?: string;
    userAgent?: string;
  },
  db: PrismaClient = defaultPrisma,
): Promise<{ id: string }> {
  const {
    userId,
    entitlementId,
    productId,
    productVersionId,
    fileId,
    channel,
    ipAddress,
    userAgent,
  } = params;

  // Hash IP and User-Agent for privacy
  const ipHash = ipAddress
    ? crypto.createHash("sha256").update(ipAddress).digest("hex")
    : null;
  const userAgentHash = userAgent
    ? crypto.createHash("sha256").update(userAgent).digest("hex")
    : null;

  return db.$transaction(async (tx) => {
    const event = await tx.downloadEvent.create({
      data: {
        userId: userId || null,
        entitlementId,
        productId,
        productVersionId,
        fileId,
        channel,
        ipHash,
        userAgentHash,
      },
    });

    await tx.auditLog.create({
      data: {
        action: "DOWNLOAD_URL_ISSUED",
        entity: "DownloadEvent",
        entityId: event.id,
        actorId: userId || null,
        details: {
          entitlementId,
          productId,
          productVersionId,
          fileId,
          channel,
        },
      },
    });

    return { id: event.id };
  });
}
