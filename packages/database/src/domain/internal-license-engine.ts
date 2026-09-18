import {
  PrismaClient,
  LicenseStatus,
  EntitlementStatus,
  FulfillmentType,
} from "@prisma/client";
import { prisma } from "../client";
import {
  normalizeDomain,
  generateLicenseKey,
  normalizeLicenseKey,
  hashLicenseKey,
  extractKeyLast4,
  maskLicenseKey,
  encryptLicenseKey,
  decryptLicenseKey,
} from "@nexus/utils";
import {
  CustomerLicenseDto,
  RevealLicenseResponse,
  ActivateLicenseResponse,
  ValidateLicenseResponse,
  DeactivateLicenseResponse,
  AdminLicenseDto,
  AdminLicenseRevokeReason,
} from "@nexus/contracts";

export class InternalLicenseEngineError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "InternalLicenseEngineError";
  }
}

export interface ProvisionInternalLicensesParams {
  batchSize?: number;
  workerId?: string;
}

export interface ProvisionInternalLicensesResult {
  provisionedCount: number;
  licenseIds: string[];
}

/**
 * Worker provisioner:
 * Finds ACTIVE entitlements where fulfillmentType = INTERNAL_LICENSE
 * that do not have an InternalLicense record.
 * Idempotent, concurrency-safe via FOR UPDATE SKIP LOCKED.
 */
export async function provisionInternalLicenses(
  params?: ProvisionInternalLicensesParams,
  db: PrismaClient = prisma,
): Promise<ProvisionInternalLicensesResult> {
  const batchSize = params?.batchSize || 100;
  const workerId = params?.workerId || "worker-default";

  return db.$transaction(async (tx) => {
    const candidateEntitlements = await tx.$queryRaw<
      Array<{
        id: string;
        user_id: string;
        product_id: string;
        variant_id: string;
        max_activations: number | null;
        expires_at: Date | null;
        updates_until: Date | null;
        support_until: Date | null;
      }>
    >`
      SELECT e.id, e.user_id, e.product_id, e.variant_id, e.max_activations, e.expires_at, e.updates_until, e.support_until
      FROM entitlements e
      LEFT JOIN internal_licenses il ON e.id = il.entitlement_id
      WHERE e.fulfillment_type = 'INTERNAL_LICENSE'
        AND e.status = 'ACTIVE'
        AND (e.expires_at IS NULL OR e.expires_at > NOW())
        AND il.id IS NULL
      LIMIT ${batchSize}
      FOR UPDATE OF e SKIP LOCKED
    `;

    if (!candidateEntitlements || candidateEntitlements.length === 0) {
      return { provisionedCount: 0, licenseIds: [] };
    }

    const createdIds: string[] = [];

    for (const ent of candidateEntitlements) {
      // 1. Generate high-entropy license key
      const plaintextKey = generateLicenseKey();
      const keyHash = hashLicenseKey(plaintextKey);
      const encrypted = encryptLicenseKey(plaintextKey);
      const keyLast4 = extractKeyLast4(plaintextKey);

      // 2. Conflict-safe insert (ON CONFLICT DO NOTHING on entitlement_id)
      const insertResult = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO internal_licenses (
          id, entitlement_id, user_id, product_id, variant_id, status,
          key_hash, key_ciphertext, key_iv, key_auth_tag, key_last4,
          created_at, updated_at
        ) VALUES (
          gen_random_uuid(), ${ent.id}, ${ent.user_id}, ${ent.product_id}, ${ent.variant_id}, 'ACTIVE',
          ${keyHash}, ${encrypted.ciphertext}, ${encrypted.iv}, ${encrypted.authTag}, ${keyLast4},
          NOW(), NOW()
        )
        ON CONFLICT ("entitlement_id") DO NOTHING
        RETURNING id
      `;

      if (insertResult && insertResult.length > 0) {
        const licenseId = insertResult[0].id;
        createdIds.push(licenseId);

        // 3. Record transactional audit log (ZERO plaintext key)
        await tx.auditLog.create({
          data: {
            action: "INTERNAL_LICENSE_CREATED",
            entity: "InternalLicense",
            entityId: licenseId,
            actorId: null, // worker system action
            details: {
              entitlementId: ent.id,
              userId: ent.user_id,
              productId: ent.product_id,
              variantId: ent.variant_id,
              keyLast4,
              workerId,
            },
          },
        });
      }
    }

    return {
      provisionedCount: createdIds.length,
      licenseIds: createdIds,
    };
  });
}

export interface ActivateInternalLicenseParams {
  licenseKey: string;
  domain: string;
}

/**
 * Public activation endpoint domain function:
 * Validates license, domain normalization, entitlement active window, and capacity.
 * Concurrency-safe: locks InternalLicense and Entitlement FOR UPDATE.
 * Same-domain activation is idempotent and does NOT consume an extra seat.
 */
export async function activateInternalLicense(
  params: ActivateInternalLicenseParams,
  db: PrismaClient = prisma,
): Promise<ActivateLicenseResponse> {
  // 1. Validate & normalize domain
  let normalizedDomain: string;
  try {
    normalizedDomain = normalizeDomain(params.domain);
  } catch {
    throw new InternalLicenseEngineError("Invalid license key or domain", 400);
  }

  // 2. Normalize key and hash
  let normalizedKey: string;
  try {
    normalizedKey = normalizeLicenseKey(params.licenseKey);
  } catch {
    throw new InternalLicenseEngineError("Invalid license key or domain", 400);
  }
  const keyHash = hashLicenseKey(normalizedKey);

  return db.$transaction(async (tx) => {
    // 3. Lock InternalLicense by keyHash
    const licenseRows = await tx.$queryRaw<
      Array<{
        id: string;
        entitlement_id: string;
        user_id: string;
        product_id: string;
        variant_id: string;
        status: LicenseStatus;
        key_last4: string;
      }>
    >`
      SELECT id, entitlement_id, user_id, product_id, variant_id, status, key_last4
      FROM internal_licenses
      WHERE key_hash = ${keyHash}
      FOR UPDATE
    `;

    if (!licenseRows || licenseRows.length === 0) {
      throw new InternalLicenseEngineError("Invalid license key or domain", 400);
    }
    const license = licenseRows[0];

    // 4. Lock parent Entitlement
    const entRows = await tx.$queryRaw<
      Array<{
        id: string;
        status: EntitlementStatus;
        fulfillment_type: FulfillmentType;
        max_activations: number | null;
        expires_at: Date | null;
        updates_until: Date | null;
        support_until: Date | null;
      }>
    >`
      SELECT id, status, fulfillment_type, max_activations, expires_at, updates_until, support_until
      FROM entitlements
      WHERE id = ${license.entitlement_id}
      FOR UPDATE
    `;

    if (!entRows || entRows.length === 0) {
      throw new InternalLicenseEngineError("Invalid license key or domain", 400);
    }
    const entitlement = entRows[0];

    // 5. Enforce Authoritative Rights (Fail Closed with anti-enumeration message)
    if (license.status !== "ACTIVE") {
      throw new InternalLicenseEngineError("Invalid license key or domain", 400);
    }
    if (entitlement.status !== "ACTIVE") {
      throw new InternalLicenseEngineError("Invalid license key or domain", 400);
    }
    if (entitlement.fulfillment_type !== "INTERNAL_LICENSE") {
      throw new InternalLicenseEngineError("Invalid license key or domain", 400);
    }
    if (entitlement.expires_at && new Date(entitlement.expires_at) <= new Date()) {
      throw new InternalLicenseEngineError("Invalid license key or domain", 400);
    }
    if (
      entitlement.max_activations === null ||
      entitlement.max_activations === undefined ||
      entitlement.max_activations <= 0
    ) {
      throw new InternalLicenseEngineError("Invalid license key or domain", 400);
    }

    // 6. Same-Domain Idempotency Check
    const existingActiveActivation = await tx.licenseActivation.findFirst({
      where: {
        licenseId: license.id,
        normalizedDomain,
        status: "ACTIVE",
      },
    });

    if (existingActiveActivation) {
      // Return existing valid activation without consuming an extra seat
      return {
        valid: true,
        status: "ACTIVE",
        domain: normalizedDomain,
        activatedAt: existingActiveActivation.activatedAt.toISOString(),
        expiresAt: entitlement.expires_at?.toISOString() ?? null,
        updatesUntil: entitlement.updates_until?.toISOString() ?? null,
        supportUntil: entitlement.support_until?.toISOString() ?? null,
      };
    }

    // 7. Capacity Check
    const activeCount = await tx.licenseActivation.count({
      where: {
        licenseId: license.id,
        status: "ACTIVE",
      },
    });

    if (activeCount >= entitlement.max_activations) {
      throw new InternalLicenseEngineError(
        `License activation capacity reached: maximum ${entitlement.max_activations} active domain(s) permitted`,
        409,
      );
    }

    // 8. Re-activate existing DEACTIVATED record OR create new LicenseActivation
    const existingRecord = await tx.licenseActivation.findFirst({
      where: {
        licenseId: license.id,
        normalizedDomain,
      },
    });

    let activation;
    if (existingRecord) {
      activation = await tx.licenseActivation.update({
        where: { id: existingRecord.id },
        data: {
          status: "ACTIVE",
          activatedAt: new Date(),
          deactivatedAt: null,
          lastValidatedAt: new Date(),
          metadata: {},
        },
      });
    } else {
      activation = await tx.licenseActivation.create({
        data: {
          licenseId: license.id,
          userId: license.user_id,
          normalizedDomain,
          status: "ACTIVE",
          activatedAt: new Date(),
          lastValidatedAt: new Date(),
          metadata: {},
        },
      });
    }

    // 10. Record transactional audit log (Safe fields only, NO plaintext key)
    await tx.auditLog.create({
      data: {
        action: "LICENSE_ACTIVATED",
        entity: "LicenseActivation",
        entityId: activation.id,
        actorId: license.user_id,
        details: {
          licenseId: license.id,
          entitlementId: license.entitlement_id,
          normalizedDomain,
          keyLast4: license.key_last4,
        },
      },
    });

    return {
      valid: true,
      status: "ACTIVE",
      domain: normalizedDomain,
      activatedAt: activation.activatedAt.toISOString(),
      expiresAt: entitlement.expires_at?.toISOString() ?? null,
      updatesUntil: entitlement.updates_until?.toISOString() ?? null,
      supportUntil: entitlement.support_until?.toISOString() ?? null,
    };
  });
}

export interface ValidateInternalLicenseParams {
  licenseKey: string;
  domain: string;
}

/**
 * Public validation endpoint domain function:
 * Validates that license is ACTIVE, entitlement is ACTIVE and unexpired,
 * and an ACTIVE activation for normalizedDomain exists.
 * Returns generic invalid response on any failure (no enumeration).
 */
export async function validateInternalLicense(
  params: ValidateInternalLicenseParams,
  db: PrismaClient = prisma,
): Promise<ValidateLicenseResponse> {
  let normalizedDomain: string;
  try {
    normalizedDomain = normalizeDomain(params.domain);
  } catch {
    return { valid: false };
  }

  let normalizedKey: string;
  try {
    normalizedKey = normalizeLicenseKey(params.licenseKey);
  } catch {
    return { valid: false };
  }
  const keyHash = hashLicenseKey(normalizedKey);

  const license = await db.internalLicense.findUnique({
    where: { keyHash },
    include: {
      entitlement: true,
      activations: {
        where: {
          normalizedDomain,
          status: "ACTIVE",
        },
      },
    },
  });

  if (!license) {
    return { valid: false };
  }

  // 1. License status check
  if (license.status !== "ACTIVE") {
    return { valid: false };
  }

  // 2. Entitlement status check
  if (license.entitlement.status !== "ACTIVE") {
    return { valid: false };
  }

  // 3. Fulfillment type check (Authoritative internal license)
  if (license.entitlement.fulfillmentType !== "INTERNAL_LICENSE") {
    return { valid: false };
  }

  // 4. Expiration check
  if (
    license.entitlement.expiresAt &&
    new Date(license.entitlement.expiresAt) <= new Date()
  ) {
    return { valid: false };
  }

  // 5. Matching active domain activation check
  if (!license.activations || license.activations.length === 0) {
    return { valid: false };
  }

  const activation = license.activations[0];

  // Update lastValidatedAt asynchronously
  try {
    await db.licenseActivation.update({
      where: { id: activation.id },
      data: { lastValidatedAt: new Date() },
    });
  } catch {
    // Non-critical background timestamp update
  }

  return {
    valid: true,
    status: "ACTIVE",
    domain: normalizedDomain,
    expiresAt: license.entitlement.expiresAt?.toISOString() ?? null,
    updatesUntil: license.entitlement.updatesUntil?.toISOString() ?? null,
    supportUntil: license.entitlement.supportUntil?.toISOString() ?? null,
  };
}

export interface DeactivateInternalLicenseParams {
  licenseKey: string;
  domain: string;
}

/**
 * Public deactivation endpoint domain function:
 * Releases capacity for a previously activated domain.
 * Anti-enumeration: returns success for unknown keys or unactivated domains.
 * Atomic CAS via updateMany ensuring exactly-once transition audit.
 */
export async function deactivateInternalLicense(
  params: DeactivateInternalLicenseParams,
  db: PrismaClient = prisma,
): Promise<DeactivateLicenseResponse> {
  let normalizedDomain: string;
  try {
    normalizedDomain = normalizeDomain(params.domain);
  } catch {
    throw new InternalLicenseEngineError("Invalid license key or domain", 400);
  }

  let normalizedKey: string;
  try {
    normalizedKey = normalizeLicenseKey(params.licenseKey);
  } catch {
    throw new InternalLicenseEngineError("Invalid license key or domain", 400);
  }
  const keyHash = hashLicenseKey(normalizedKey);

  return db.$transaction(async (tx) => {
    const license = await tx.internalLicense.findUnique({
      where: { keyHash },
    });

    if (!license) {
      // Anti-enumeration: return success for unknown keys without leaking key existence
      return {
        success: true,
        domain: normalizedDomain,
        deactivatedAt: new Date().toISOString(),
      };
    }

    // Atomic CAS: only transitions if status is currently ACTIVE
    const deactivationTime = new Date();
    const updateResult = await tx.licenseActivation.updateMany({
      where: {
        licenseId: license.id,
        normalizedDomain,
        status: "ACTIVE",
      },
      data: {
        status: "DEACTIVATED",
        deactivatedAt: deactivationTime,
      },
    });

    // Record transactional audit log ONLY if an active activation was transitioned (exactly once)
    if (updateResult.count > 0) {
      const actRecord = await tx.licenseActivation.findFirst({
        where: {
          licenseId: license.id,
          normalizedDomain,
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          action: "LICENSE_DEACTIVATED",
          entity: "LicenseActivation",
          entityId: actRecord?.id ?? license.id,
          actorId: license.userId,
          details: {
            licenseId: license.id,
            entitlementId: license.entitlementId,
            normalizedDomain,
            keyLast4: license.keyLast4,
          },
        },
      });
    }

    return {
      success: true,
      domain: normalizedDomain,
      deactivatedAt: deactivationTime.toISOString(),
    };
  });
}

export interface CustomerDeactivateDomainParams {
  licenseId: string;
  userId: string;
  domain: string;
}

/**
 * Authenticated customer endpoint function:
 * Authoritatively deactivates domain activation for license owner.
 * Returns 404 for cross-user or non-existent license ID (anti-enumeration).
 * ZERO plaintext license key needed or exposed in request, response, or audit logs.
 */
export async function customerDeactivateDomain(
  params: CustomerDeactivateDomainParams,
  db: PrismaClient = prisma,
): Promise<DeactivateLicenseResponse> {
  let normalizedDomain: string;
  try {
    normalizedDomain = normalizeDomain(params.domain);
  } catch {
    throw new InternalLicenseEngineError("Invalid domain format", 400);
  }

  return db.$transaction(async (tx) => {
    const license = await tx.internalLicense.findFirst({
      where: {
        id: params.licenseId,
        userId: params.userId,
      },
    });

    if (!license) {
      throw new InternalLicenseEngineError("License not found", 404);
    }

    if (license.status === "REVOKED") {
      throw new InternalLicenseEngineError("License has been revoked", 409);
    }

    const deactivationTime = new Date();
    const updateResult = await tx.licenseActivation.updateMany({
      where: {
        licenseId: license.id,
        normalizedDomain,
        status: "ACTIVE",
      },
      data: {
        status: "DEACTIVATED",
        deactivatedAt: deactivationTime,
      },
    });

    if (updateResult.count > 0) {
      const actRecord = await tx.licenseActivation.findFirst({
        where: {
          licenseId: license.id,
          normalizedDomain,
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          action: "LICENSE_DEACTIVATED",
          entity: "LicenseActivation",
          entityId: actRecord?.id ?? license.id,
          actorId: params.userId,
          details: {
            licenseId: license.id,
            entitlementId: license.entitlementId,
            normalizedDomain,
            keyLast4: license.keyLast4,
          },
        },
      });
    }

    return {
      success: true,
      domain: normalizedDomain,
      deactivatedAt: deactivationTime.toISOString(),
    };
  });
}

export interface CustomerRevealLicenseParams {
  licenseId: string;
  userId: string;
}

/**
 * Authenticated customer endpoint function:
 * Decrypts and reveals license key strictly to its owner.
 * Returns 404 for cross-user or non-existent license ID.
 * Audit log NEVER records plaintext key.
 */
export async function customerRevealLicenseKey(
  params: CustomerRevealLicenseParams,
  db: PrismaClient = prisma,
): Promise<RevealLicenseResponse> {
  const license = await db.internalLicense.findFirst({
    where: {
      id: params.licenseId,
      userId: params.userId,
    },
  });

  if (!license) {
    throw new InternalLicenseEngineError("License not found", 404);
  }

  const plaintextKey = decryptLicenseKey(
    license.keyCiphertext,
    license.keyIv,
    license.keyAuthTag,
  );

  // Record audit log with keyLast4 only
  await db.auditLog.create({
    data: {
      action: "LICENSE_KEY_REVEALED",
      entity: "InternalLicense",
      entityId: license.id,
      actorId: params.userId,
      details: {
        licenseId: license.id,
        entitlementId: license.entitlementId,
        keyLast4: license.keyLast4,
      },
    },
  });

  return {
    licenseId: license.id,
    licenseKey: plaintextKey,
    keyMasked: maskLicenseKey(plaintextKey),
  };
}

/**
 * Lists licenses owned by an authenticated customer.
 * Sanitized response: key is masked, ciphertext/hash/iv/tag are omitted.
 */
export async function listCustomerLicenses(
  userId: string,
  db: PrismaClient = prisma,
): Promise<CustomerLicenseDto[]> {
  const licenses = await db.internalLicense.findMany({
    where: { userId },
    include: {
      entitlement: true,
      activations: {
        where: { status: "ACTIVE" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return licenses.map((lic) => ({
    id: lic.id,
    productId: lic.productId,
    variantId: lic.variantId,
    status: lic.status,
    keyMasked: `NXS-****-****-****-****-****-****-****-${lic.keyLast4}`,
    maxActivations: lic.entitlement.maxActivations,
    activeActivations: lic.activations.length,
    expiresAt: lic.entitlement.expiresAt?.toISOString() ?? null,
    updatesUntil: lic.entitlement.updatesUntil?.toISOString() ?? null,
    supportUntil: lic.entitlement.supportUntil?.toISOString() ?? null,
    createdAt: lic.createdAt.toISOString(),
  }));
}

/**
 * Gets a single license owned by an authenticated customer.
 * 404 for cross-user access.
 */
export async function getCustomerLicense(
  licenseId: string,
  userId: string,
  db: PrismaClient = prisma,
): Promise<CustomerLicenseDto> {
  const lic = await db.internalLicense.findFirst({
    where: { id: licenseId, userId },
    include: {
      entitlement: true,
      activations: {
        where: { status: "ACTIVE" },
      },
    },
  });

  if (!lic) {
    throw new InternalLicenseEngineError("License not found", 404);
  }

  return {
    id: lic.id,
    productId: lic.productId,
    variantId: lic.variantId,
    status: lic.status,
    keyMasked: `NXS-****-****-****-****-****-****-****-${lic.keyLast4}`,
    maxActivations: lic.entitlement.maxActivations,
    activeActivations: lic.activations.length,
    expiresAt: lic.entitlement.expiresAt?.toISOString() ?? null,
    updatesUntil: lic.entitlement.updatesUntil?.toISOString() ?? null,
    supportUntil: lic.entitlement.supportUntil?.toISOString() ?? null,
    createdAt: lic.createdAt.toISOString(),
  };
}

export const ALLOWED_ADMIN_REVOKE_REASONS: AdminLicenseRevokeReason[] = [
  "ADMINISTRATIVE",
  "REFUND",
  "FRAUD",
  "SUPPORT",
  "SECURITY",
  "OTHER",
];

export interface AdminRevokeLicenseParams {
  licenseId: string;
  actorId: string;
  reasonCode?: AdminLicenseRevokeReason | string;
}

/**
 * Admin manual revocation of internal license fulfillment record.
 * Requires license.manage permission.
 * Deactivates all currently active activations.
 * Records typed reasonCode only; never stores plaintext keys or free-form secrets.
 */
export async function adminRevokeLicense(
  params: AdminRevokeLicenseParams,
  db: PrismaClient = prisma,
): Promise<AdminLicenseDto> {
  // Validate reasonCode safely (fail closed if secret pattern or invalid value)
  let safeReasonCode: AdminLicenseRevokeReason = "ADMINISTRATIVE";
  if (params.reasonCode) {
    if (
      typeof params.reasonCode === "string" &&
      /NXS-(?:[0-9A-F]{4}-){7}[0-9A-F]{4}/i.test(params.reasonCode)
    ) {
      throw new InternalLicenseEngineError("Invalid revoke reason code", 400);
    }

    if (
      !ALLOWED_ADMIN_REVOKE_REASONS.includes(
        params.reasonCode as AdminLicenseRevokeReason,
      )
    ) {
      throw new InternalLicenseEngineError("Invalid revoke reason code", 400);
    }
    safeReasonCode = params.reasonCode as AdminLicenseRevokeReason;
  }

  return db.$transaction(async (tx) => {
    const licenseRows = await tx.$queryRaw<
      Array<{
        id: string;
        entitlement_id: string;
        user_id: string;
        product_id: string;
        variant_id: string;
        status: LicenseStatus;
        key_last4: string;
        created_at: Date;
        updated_at: Date;
        revoked_at: Date | null;
      }>
    >`
      SELECT id, entitlement_id, user_id, product_id, variant_id, status, key_last4, created_at, updated_at, revoked_at
      FROM internal_licenses
      WHERE id = ${params.licenseId}
      FOR UPDATE
    `;

    if (!licenseRows || licenseRows.length === 0) {
      throw new InternalLicenseEngineError("License not found", 404);
    }
    const license = licenseRows[0];

    const ent = await tx.entitlement.findUnique({
      where: { id: license.entitlement_id },
    });

    if (license.status === "REVOKED") {
      return {
        id: license.id,
        entitlementId: license.entitlement_id,
        userId: license.user_id,
        productId: license.product_id,
        variantId: license.variant_id,
        status: license.status,
        keyLast4: license.key_last4,
        maxActivations: ent?.maxActivations ?? null,
        activeActivations: 0,
        createdAt: license.created_at.toISOString(),
        updatedAt: license.updated_at.toISOString(),
        revokedAt: license.revoked_at?.toISOString() ?? null,
      };
    }

    const now = new Date();
    const updated = await tx.internalLicense.update({
      where: { id: license.id },
      data: {
        status: "REVOKED",
        revokedAt: now,
      },
    });

    // Deactivate all active activations
    await tx.licenseActivation.updateMany({
      where: {
        licenseId: license.id,
        status: "ACTIVE",
      },
      data: {
        status: "DEACTIVATED",
        deactivatedAt: now,
      },
    });

    // Record transactional audit log (exactly once with typed reasonCode only)
    await tx.auditLog.create({
      data: {
        action: "INTERNAL_LICENSE_REVOKED",
        entity: "InternalLicense",
        entityId: license.id,
        actorId: params.actorId,
        details: {
          licenseId: license.id,
          entitlementId: license.entitlement_id,
          keyLast4: license.key_last4,
          reasonCode: safeReasonCode,
        },
      },
    });

    return {
      id: updated.id,
      entitlementId: updated.entitlementId,
      userId: updated.userId,
      productId: updated.productId,
      variantId: updated.variantId,
      status: updated.status,
      keyLast4: updated.keyLast4,
      maxActivations: ent?.maxActivations ?? null,
      activeActivations: 0,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      revokedAt: updated.revokedAt?.toISOString() ?? null,
    };
  });
}

/**
 * Admin list internal licenses.
 * Enforces license.read permission.
 * Never exposes plaintext keys or encryption secrets.
 */
export async function adminListLicenses(
  db: PrismaClient = prisma,
): Promise<AdminLicenseDto[]> {
  const licenses = await db.internalLicense.findMany({
    include: {
      entitlement: true,
      activations: { where: { status: "ACTIVE" } },
    },
    orderBy: { createdAt: "desc" },
  });

  return licenses.map((lic) => ({
    id: lic.id,
    entitlementId: lic.entitlementId,
    userId: lic.userId,
    productId: lic.productId,
    variantId: lic.variantId,
    status: lic.status,
    keyLast4: lic.keyLast4,
    maxActivations: lic.entitlement.maxActivations,
    activeActivations: lic.activations.length,
    createdAt: lic.createdAt.toISOString(),
    updatedAt: lic.updatedAt.toISOString(),
    revokedAt: lic.revokedAt?.toISOString() ?? null,
  }));
}

/**
 * Admin get single internal license.
 */
export async function adminGetLicense(
  licenseId: string,
  db: PrismaClient = prisma,
): Promise<AdminLicenseDto> {
  const lic = await db.internalLicense.findUnique({
    where: { id: licenseId },
    include: {
      entitlement: true,
      activations: { where: { status: "ACTIVE" } },
    },
  });

  if (!lic) {
    throw new InternalLicenseEngineError("License not found", 404);
  }

  return {
    id: lic.id,
    entitlementId: lic.entitlementId,
    userId: lic.userId,
    productId: lic.productId,
    variantId: lic.variantId,
    status: lic.status,
    keyLast4: lic.keyLast4,
    maxActivations: lic.entitlement.maxActivations,
    activeActivations: lic.activations.length,
    createdAt: lic.createdAt.toISOString(),
    updatedAt: lic.updatedAt.toISOString(),
    revokedAt: lic.revokedAt?.toISOString() ?? null,
  };
}

export interface ReconcileInternalLicensesParams {
  batchSize?: number;
  workerId?: string;
}

export interface ReconcileInternalLicensesResult {
  reconciledCount: number;
  licenseIds: string[];
}

/**
 * Worker reconciler:
 * Sweeps ACTIVE internal licenses whose parent Entitlement is REVOKED or EXPIRED.
 * Transitions InternalLicense to REVOKED and deactivates active activations.
 * Concurrency-safe via FOR UPDATE OF il SKIP LOCKED.
 */
export async function reconcileInternalLicenses(
  params?: ReconcileInternalLicensesParams,
  db: PrismaClient = prisma,
): Promise<ReconcileInternalLicensesResult> {
  const batchSize = params?.batchSize || 100;
  const workerId = params?.workerId || "worker-default";

  return db.$transaction(async (tx) => {
    const candidateRows = await tx.$queryRaw<
      Array<{
        id: string;
        entitlement_id: string;
        key_last4: string;
        entitlement_status: EntitlementStatus;
      }>
    >`
      SELECT il.id, il.entitlement_id, il.key_last4, e.status as entitlement_status
      FROM internal_licenses il
      JOIN entitlements e ON il.entitlement_id = e.id
      WHERE il.status = 'ACTIVE'
        AND (e.status IN ('REVOKED', 'EXPIRED') OR (e.expires_at IS NOT NULL AND e.expires_at <= NOW()))
      LIMIT ${batchSize}
      FOR UPDATE OF il SKIP LOCKED
    `;

    if (!candidateRows || candidateRows.length === 0) {
      return { reconciledCount: 0, licenseIds: [] };
    }

    const licenseIds = candidateRows.map((r) => r.id);

    // 1. Mark licenses as REVOKED
    await tx.internalLicense.updateMany({
      where: { id: { in: licenseIds } },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
      },
    });

    // 2. Deactivate active activations for these licenses
    await tx.licenseActivation.updateMany({
      where: {
        licenseId: { in: licenseIds },
        status: "ACTIVE",
      },
      data: {
        status: "DEACTIVATED",
        deactivatedAt: new Date(),
      },
    });

    // 3. Record audit log for each revoked license
    for (const row of candidateRows) {
      await tx.auditLog.create({
        data: {
          action: "INTERNAL_LICENSE_REVOKED",
          entity: "InternalLicense",
          entityId: row.id,
          actorId: null, // worker system action
          details: {
            entitlementId: row.entitlement_id,
            entitlementStatus: row.entitlement_status,
            keyLast4: row.key_last4,
            workerId,
            reason: `Parent entitlement transitioned to ${row.entitlement_status}`,
          },
        },
      });
    }

    return {
      reconciledCount: candidateRows.length,
      licenseIds,
    };
  });
}
