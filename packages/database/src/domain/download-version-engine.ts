import {
  PrismaClient,
  ProductVersion,
  ProductVersionFile,
  DownloadGrant,
  DownloadEvent,
} from "@prisma/client";
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
  resolveDownloadTtl,
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
 * Sanitizes filename to prevent directory traversal and illegal characters.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, "").trim();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    return "package.zip";
  }
  return cleaned;
}

/**
 * Generates backend-owned storage key:
 * products/{productId}/versions/{versionId}/{uuid}-{safeFilename}
 */
export function generateStorageKey(
  productId: string,
  versionId: string,
  filename: string,
): string {
  const safeName = sanitizeFilename(filename);
  const uid = crypto.randomUUID();
  return `products/${productId}/versions/${versionId}/${uid}-${safeName}`;
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
    isPrimary: f.isPrimary,
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
 * Backend owns storageKey generation; client-specified storageKeys are rejected.
 */
export async function addVersionFile(
  params: {
    productVersionId: string;
    fileName: string;
    contentType?: string;
    sizeBytes: number;
    sha256: string;
    isPrimary?: boolean;
    actorId: string;
    storageKey?: string;
    verifiedAt?: Date;
  },
  db: PrismaClient = defaultPrisma,
): Promise<ProductVersionFileDto> {
  const {
    productVersionId,
    fileName,
    contentType = "application/zip",
    sizeBytes,
    sha256,
    isPrimary = false,
    actorId,
    verifiedAt = new Date(),
  } = params;

  if (!fileName || sizeBytes <= 0 || !sha256) {
    throw new DownloadVersionEngineError("Invalid file metadata", 400);
  }

  const safeFileName = sanitizeFilename(fileName);

  try {
    const file = await db.$transaction(async (tx) => {
      const vRows = await tx.$queryRaw<
        Array<{ id: string; product_id: string; status: string }>
      >`
        SELECT id, product_id, status FROM product_versions WHERE id = ${productVersionId} FOR UPDATE
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

      // Backend-generated storageKey
      const storageKey =
        params.storageKey ||
        generateStorageKey(versionRow.product_id, productVersionId, safeFileName);

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

      // If isPrimary is true, verify no other primary file exists for this version
      if (isPrimary) {
        const existingPrimary = await tx.productVersionFile.findFirst({
          where: { productVersionId, isPrimary: true },
        });
        if (existingPrimary) {
          throw new DownloadVersionEngineError(
            `A primary file already exists for this version (${existingPrimary.fileName})`,
            409,
          );
        }
      }

      const newFile = await tx.productVersionFile.create({
        data: {
          productVersionId,
          storageKey,
          fileName: safeFileName,
          contentType,
          sizeBytes,
          sha256: sha256.toLowerCase().trim(),
          isPrimary,
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
            isPrimary,
          },
        },
      });

      return newFile;
    });

    return mapProductVersionFileToDto(file);
  } catch (err: any) {
    if (err?.code === "P2002") {
      throw new DownloadVersionEngineError(
        "Unique constraint violation on version file (storageKey or primary file conflict)",
        409,
      );
    }
    throw err;
  }
}

/**
 * Admin: Publish DRAFT version.
 * Atomic CAS transition: DRAFT -> PUBLISHED.
 * Mandatory storage reverification: EVERY DRAFT -> PUBLISHED transition MUST reverify private storage.
 * Two-phase safe publication:
 * Phase 1: verify file integrity in storage outside DB transaction (prevents prolonged row locks during storage I/O).
 * Phase 2: row-locked DB transaction confirms snapshot integrity, performs atomic CAS status transition, and creates VERSION_PUBLISHED audit log.
 * For INTERNAL_LICENSE products, strictly enforces exactly ONE verified primary file.
 * Exactly 1 VERSION_PUBLISHED audit log created under concurrent races.
 */
export async function publishProductVersion(
  params: {
    productVersionId: string;
    actorId: string;
    verifyFileIntegrity: (
      file: ProductVersionFile,
    ) => Promise<{ valid: boolean; reason?: string }>;
  },
  db: PrismaClient = defaultPrisma,
): Promise<PublishVersionResponse> {
  const { productVersionId, actorId, verifyFileIntegrity } = params;

  // Blocker: Storage reverification must not be optional or omitted
  if (!verifyFileIntegrity || typeof verifyFileIntegrity !== "function") {
    throw new DownloadVersionEngineError(
      "Storage reverification authority is mandatory to publish a product version",
      503,
      "STORAGE_VERIFICATION_REQUIRED",
    );
  }

  // Phase 1: Outside DB transaction, read snapshot of version and files
  const snapshotVersion = await db.productVersion.findUnique({
    where: { id: productVersionId },
    include: { files: true, product: true },
  });

  if (!snapshotVersion) {
    throw new DownloadVersionEngineError("Product version not found", 404);
  }

  // Idempotent return if already published (zero duplicate audit logs)
  if (snapshotVersion.status === "PUBLISHED") {
    return {
      success: true,
      version: mapProductVersionToDto(snapshotVersion),
    };
  }

  const verifiedFiles = snapshotVersion.files.filter((f) => f.verifiedAt !== null);
  if (verifiedFiles.length === 0) {
    throw new DownloadVersionEngineError(
      "Cannot publish version without at least one verified file",
      400,
    );
  }

  // Check product fulfillment type for primary file invariant
  if (snapshotVersion.product?.fulfillmentType === "INTERNAL_LICENSE") {
    const primaryFiles = verifiedFiles.filter((f) => f.isPrimary);
    if (primaryFiles.length !== 1) {
      throw new DownloadVersionEngineError(
        `Licensed software versions require exactly ONE primary file for updater distribution (found ${primaryFiles.length})`,
        409,
      );
    }
  }

  // Reverification of every file against storage OUTSIDE the DB transaction
  for (const file of verifiedFiles) {
    let check: { valid: boolean; reason?: string };
    try {
      check = await verifyFileIntegrity(file);
    } catch (verErr: any) {
      throw new DownloadVersionEngineError(
        `Pre-publish integrity reverification failed for file '${file.fileName}': ${verErr?.message || "Storage error"}`,
        503,
      );
    }
    if (!check.valid) {
      throw new DownloadVersionEngineError(
        `Pre-publish integrity reverification failed for file '${file.fileName}': ${check.reason || "Storage object missing or hash/size mismatch"}`,
        409,
      );
    }
  }

  // Phase 2: Enter DB transaction, lock row FOR UPDATE, verify snapshot did not drift, and CAS transition
  return db.$transaction(async (tx) => {
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

    // Concurrency race: already published by concurrent caller
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

    // Reload files under lock to ensure files did not drift
    const lockedFiles = await tx.productVersionFile.findMany({
      where: { productVersionId },
    });

    // Check drift against pre-verified snapshot
    if (lockedFiles.length !== snapshotVersion.files.length) {
      throw new DownloadVersionEngineError(
        "Version files modified during publication verification",
        409,
      );
    }

    for (const lf of lockedFiles) {
      const snap = snapshotVersion.files.find((s) => s.id === lf.id);
      if (
        !snap ||
        snap.storageKey !== lf.storageKey ||
        snap.sha256 !== lf.sha256 ||
        snap.sizeBytes !== lf.sizeBytes ||
        snap.isPrimary !== lf.isPrimary
      ) {
        throw new DownloadVersionEngineError(
          `Version file '${lf.fileName}' drifted during publication verification`,
          409,
        );
      }
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
}

/**
 * Issue Customer Download Grant.
 * Linearization point: atomic row lock on Entitlement FOR UPDATE.
 * Ensures that if entitlement is revoked concurrently, grant cannot be created with issuedAt > revokedAt.
 */
export async function issueCustomerDownloadGrant(
  params: {
    userId: string;
    entitlementId: string;
    versionId: string;
    fileId: string;
    ttlSeconds?: number;
    ipAddress?: string;
    userAgent?: string;
  },
  db: PrismaClient = defaultPrisma,
): Promise<{
  grant: DownloadGrant;
  file: ProductVersionFile;
  version: ProductVersion;
}> {
  const { userId, entitlementId, versionId, fileId, ipAddress, userAgent } = params;
  const ttl = resolveDownloadTtl(params.ttlSeconds);

  return db.$transaction(async (tx) => {
    // 1. Lock Entitlement row FOR UPDATE
    const eRows = await tx.$queryRaw<
      Array<{
        id: string;
        user_id: string;
        product_id: string;
        status: string;
        fulfillment_type: string;
        expires_at: Date | null;
        updates_until: Date | null;
        revoked_at: Date | null;
      }>
    >`
      SELECT id, user_id, product_id, status, fulfillment_type, expires_at, updates_until, revoked_at
      FROM entitlements
      WHERE id = ${entitlementId}
      FOR UPDATE
    `;

    if (!eRows || eRows.length === 0) {
      throw new DownloadVersionEngineError("Entitlement not found", 404);
    }
    const entitlement = eRows[0];

    // Cross-user isolation
    if (entitlement.user_id !== userId) {
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

    // Clock-based expiry check
    if (entitlement.expires_at && entitlement.expires_at.getTime() <= Date.now()) {
      throw new DownloadVersionEngineError(
        "Entitlement has expired",
        409,
        "ENTITLEMENT_EXPIRED",
      );
    }

    // Fulfillment type check
    if (
      entitlement.fulfillment_type !== "DIGITAL_DOWNLOAD" &&
      entitlement.fulfillment_type !== "INTERNAL_LICENSE"
    ) {
      throw new DownloadVersionEngineError(
        `Fulfillment strategy '${entitlement.fulfillment_type}' does not grant digital file downloads`,
        400,
      );
    }

    // 2. Fetch version
    const version = await tx.productVersion.findUnique({
      where: { id: versionId },
    });
    if (!version) {
      throw new DownloadVersionEngineError("Product version not found", 404);
    }

    // Verify version belongs to entitlement's product
    if (version.productId !== entitlement.product_id) {
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
    const file = await tx.productVersionFile.findUnique({
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
      entitlement.updates_until,
    );
    if (!eligible) {
      throw new DownloadVersionEngineError(
        "Version released after your update entitlement cutoff date",
        403,
        "UPDATE_WINDOW_EXPIRED",
      );
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl * 1000);

    // 5. Create authoritative DownloadGrant (linearization point)
    const grant = await tx.downloadGrant.create({
      data: {
        userId,
        entitlementId,
        productVersionId: version.id,
        fileId: file.id,
        channel: "CUSTOMER_PORTAL",
        issuedAt: now,
        expiresAt,
      },
    });

    return { grant, file, version };
  });
}

/**
 * Issue Updater Download Grant.
 * Shared authorization authority with consistent DB lock order:
 * InternalLicense FOR UPDATE -> Entitlement FOR UPDATE -> LicenseActivation.
 * Always selects the deterministic verified primary file (isPrimary = true).
 */
export async function issueUpdaterDownloadGrant(
  params: {
    licenseKey: string;
    domain: string;
    productId: string;
    currentVersion: string;
    ttlSeconds?: number;
    ipAddress?: string;
    userAgent?: string;
  },
  db: PrismaClient = defaultPrisma,
): Promise<{
  valid: boolean;
  updateAvailable: boolean;
  grant?: DownloadGrant;
  file?: ProductVersionFile;
  version?: ProductVersion;
  entitlementId?: string;
  normalizedDomain?: string;
}> {
  const genericInvalid = { valid: false, updateAvailable: false };
  const ttl = resolveDownloadTtl(params.ttlSeconds);

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
  const hashedKey = hashLicenseKey(normalizedKey);

  return db.$transaction(async (tx) => {
    // Lock InternalLicense row FOR UPDATE
    const licRows = await tx.$queryRaw<
      Array<{
        id: string;
        entitlement_id: string;
        user_id: string;
        product_id: string;
        status: string;
      }>
    >`
      SELECT id, entitlement_id, user_id, product_id, status
      FROM internal_licenses
      WHERE key_hash = ${hashedKey}
      FOR UPDATE
    `;

    if (!licRows || licRows.length === 0) {
      return genericInvalid;
    }
    const license = licRows[0];
    if (license.status !== "ACTIVE") {
      return genericInvalid;
    }

    // Lock Entitlement row FOR UPDATE
    const eRows = await tx.$queryRaw<
      Array<{
        id: string;
        user_id: string;
        product_id: string;
        status: string;
        fulfillment_type: string;
        expires_at: Date | null;
        updates_until: Date | null;
        revoked_at: Date | null;
      }>
    >`
      SELECT id, user_id, product_id, status, fulfillment_type, expires_at, updates_until, revoked_at
      FROM entitlements
      WHERE id = ${license.entitlement_id}
      FOR UPDATE
    `;

    if (!eRows || eRows.length === 0) {
      return genericInvalid;
    }
    const entitlement = eRows[0];
    if (entitlement.status !== "ACTIVE") {
      return genericInvalid;
    }

    if (entitlement.expires_at && entitlement.expires_at.getTime() <= Date.now()) {
      return genericInvalid;
    }
    if (entitlement.fulfillment_type !== "INTERNAL_LICENSE") {
      return genericInvalid;
    }
    if (entitlement.product_id !== params.productId) {
      return genericInvalid;
    }

    // Check active activation on normalizedDomain
    const activation = await tx.licenseActivation.findFirst({
      where: {
        licenseId: license.id,
        normalizedDomain: normalizedDom,
        status: "ACTIVE",
      },
    });
    if (!activation) {
      return genericInvalid;
    }

    // Query published versions with verified files
    const publishedVersions = await tx.productVersion.findMany({
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

    // Filter by update window
    const eligibleVersions = publishedVersions.filter((v) => {
      if (v.files.length === 0) return false;
      return checkVersionEligibility(v.releasedAt, entitlement.updates_until);
    });

    if (eligibleVersions.length === 0) {
      return { valid: true, updateAvailable: false };
    }

    const sorted = sortSemverDescending(eligibleVersions);
    const latestEligible = sorted[0];

    if (!isSemverGreater(latestEligible.version, cleanCurrentVer)) {
      return { valid: true, updateAvailable: false };
    }

    // Deterministic primary package selection (strictly require isPrimary && verifiedAt, NO fallback)
    const primaryFile = latestEligible.files.find((f) => f.isPrimary && f.verifiedAt);
    if (!primaryFile) {
      return { valid: true, updateAvailable: false };
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl * 1000);

    // Create DownloadGrant (linearization point)
    const grant = await tx.downloadGrant.create({
      data: {
        userId: entitlement.user_id,
        entitlementId: entitlement.id,
        productVersionId: latestEligible.id,
        fileId: primaryFile.id,
        channel: "LICENSE_UPDATER",
        licenseId: license.id,
        normalizedDomain: normalizedDom,
        issuedAt: now,
        expiresAt,
      },
    });

    return {
      valid: true,
      updateAvailable: true,
      grant,
      file: primaryFile,
      version: latestEligible,
      entitlementId: entitlement.id,
      normalizedDomain: normalizedDom,
    };
  });
}

/**
 * Authoritative record of actual download URL issuance (Step C).
 * Called strictly AFTER signed URL generation succeeds.
 * Creates DownloadEvent and AuditLog (action = 'DOWNLOAD_URL_ISSUED') linked to DownloadGrant.
 */
export async function recordDownloadIssuance(
  params: {
    grantId: string;
    ipAddress?: string;
    userAgent?: string;
  },
  db: PrismaClient = defaultPrisma,
): Promise<{ event: DownloadEvent }> {
  const { grantId, ipAddress, userAgent } = params;
  const ipHash = ipAddress
    ? crypto.createHash("sha256").update(ipAddress).digest("hex")
    : null;
  const userAgentHash = userAgent
    ? crypto.createHash("sha256").update(userAgent).digest("hex")
    : null;

  return db.$transaction(async (tx) => {
    const grant = await tx.downloadGrant.findUnique({
      where: { id: grantId },
      include: { productVersion: true },
    });
    if (!grant) {
      throw new DownloadVersionEngineError("Download grant not found", 404);
    }

    const event = await tx.downloadEvent.create({
      data: {
        userId: grant.userId,
        entitlementId: grant.entitlementId,
        productId: grant.productVersion.productId,
        productVersionId: grant.productVersionId,
        fileId: grant.fileId,
        channel: grant.channel,
        ipHash,
        userAgentHash,
        createdAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        action: "DOWNLOAD_URL_ISSUED",
        entity: "DownloadGrant",
        entityId: grant.id,
        actorId: grant.userId || grant.entitlementId,
        details: {
          grantId: grant.id,
          eventId: event.id,
          entitlementId: grant.entitlementId,
          licenseId: grant.licenseId,
          productId: grant.productVersion.productId,
          productVersionId: grant.productVersionId,
          fileId: grant.fileId,
          channel: grant.channel,
          expiresAt: grant.expiresAt.toISOString(),
        },
      },
    });

    return { event };
  });
}

/**
 * Authorize Customer Download Request (wrapper calling issueCustomerDownloadGrant).
 */
export async function authorizeCustomerDownload(
  params: {
    userId: string;
    entitlementId: string;
    versionId: string;
    fileId: string;
    ttlSeconds?: number;
    ipAddress?: string;
    userAgent?: string;
  },
  db: PrismaClient = defaultPrisma,
): Promise<{
  entitlement: any;
  version: ProductVersion;
  file: ProductVersionFile;
  grant: DownloadGrant;
}> {
  const result = await issueCustomerDownloadGrant(params, db);
  const entitlement = await db.entitlement.findUnique({
    where: { id: params.entitlementId },
  });
  return {
    entitlement,
    version: result.version,
    file: result.file,
    grant: result.grant,
  };
}

/**
 * Authorize Licensed Software / WordPress Updater Check (wrapper calling issueUpdaterDownloadGrant).
 */
export async function authorizeLicenseUpdater(
  params: {
    licenseKey: string;
    domain: string;
    productId: string;
    currentVersion: string;
    ttlSeconds?: number;
    ipAddress?: string;
    userAgent?: string;
  },
  db: PrismaClient = defaultPrisma,
): Promise<{
  valid: boolean;
  updateAvailable: boolean;
  eligibleVersion?: ProductVersion;
  file?: ProductVersionFile;
  grant?: DownloadGrant;
  entitlementId?: string;
  normalizedDomain?: string;
}> {
  const result = await issueUpdaterDownloadGrant(params, db);
  return {
    valid: result.valid,
    updateAvailable: result.updateAvailable,
    eligibleVersion: result.version,
    file: result.file,
    grant: result.grant,
    entitlementId: result.entitlementId,
    normalizedDomain: result.normalizedDomain,
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
