import {
  PrismaClient,
  AllocationStatus,
  EntitlementStatus,
  ProviderAccountStatus,
  FulfillmentType,
} from "@prisma/client";
import { prisma } from "../client";
import { normalizeDomain } from "@nexus/utils";

export interface RequestAllocationParams {
  entitlementId: string;
  userId: string;
  domain: string;
  providerCode?: string;
  metadata?: Record<string, any>;
}

export interface AdminActivateAllocationParams {
  allocationId: string;
  providerAccountId: string;
  actorId: string;
  notes?: string;
  metadata?: Record<string, any>;
}

export interface AdminRejectAllocationParams {
  allocationId: string;
  reason: string;
  actorId: string;
  metadata?: Record<string, any>;
}

export interface RequestDeactivationParams {
  allocationId: string;
  actorId: string;
  isCustomer?: boolean;
  reason?: string;
}

export interface AdminConfirmDeactivatedParams {
  allocationId: string;
  actorId: string;
  notes?: string;
  metadata?: Record<string, any>;
}

export interface ReconcileExternalAllocationsParams {
  batchSize?: number;
  workerId?: string;
}

export class AllocationEngineError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "AllocationEngineError";
  }
}

/**
 * Customer request for domain allocation.
 * Concurrency-safe: locks Entitlement row FOR UPDATE to enforce maxActivations and prevent races.
 */
export async function requestDomainAllocation(
  params: RequestAllocationParams,
  db: PrismaClient = prisma,
) {
  const normalized = normalizeDomain(params.domain);
  const providerCode = params.providerCode || "ELEMENTOR";

  return db.$transaction(async (tx) => {
    // 1. Lock Entitlement row
    const lockedRows = await tx.$queryRaw<Array<{
      id: string;
      user_id: string;
      status: EntitlementStatus;
      fulfillment_type: FulfillmentType;
      expires_at: Date | null;
      max_activations: number | null;
    }>>`
      SELECT id, user_id, status, fulfillment_type, expires_at, max_activations
      FROM entitlements
      WHERE id = ${params.entitlementId}
      FOR UPDATE
    `;

    if (!lockedRows || lockedRows.length === 0) {
      throw new AllocationEngineError("Entitlement not found", 404);
    }

    const entitlement = lockedRows[0];

    // 2. Ownership verification
    if (entitlement.user_id !== params.userId) {
      throw new AllocationEngineError(
        "Forbidden: You do not own this entitlement",
        403,
      );
    }

    // 3. Entitlement status & expiration checks
    if (entitlement.status === EntitlementStatus.REVOKED) {
      throw new AllocationEngineError(
        "Cannot request allocation: Entitlement is REVOKED",
        409,
      );
    }

    if (entitlement.status === EntitlementStatus.EXPIRED) {
      throw new AllocationEngineError(
        "Cannot request allocation: Entitlement is EXPIRED",
        409,
      );
    }

    if (entitlement.status !== EntitlementStatus.ACTIVE) {
      throw new AllocationEngineError(
        `Cannot request allocation: Entitlement status is ${entitlement.status}`,
        409,
      );
    }

    if (entitlement.expires_at && new Date(entitlement.expires_at) < new Date()) {
      throw new AllocationEngineError(
        "Cannot request allocation: Entitlement has expired",
        409,
      );
    }

    // 4. Fulfillment type check
    if (entitlement.fulfillment_type !== FulfillmentType.EXTERNAL_MANAGED) {
      throw new AllocationEngineError(
        `Cannot request external allocation: Entitlement fulfillment type is ${entitlement.fulfillment_type}, expected EXTERNAL_MANAGED`,
        400,
      );
    }

    // 5. maxActivations must be non-null and > 0 for EXTERNAL_MANAGED
    if (
      entitlement.max_activations === null ||
      entitlement.max_activations === undefined ||
      entitlement.max_activations <= 0
    ) {
      throw new AllocationEngineError(
        "Cannot request allocation: EXTERNAL_MANAGED entitlement requires non-null positive maxActivations",
        400,
      );
    }

    // 6. Count active capacity consumption on this entitlement
    // PENDING, ACTIVE, and DEACTIVATION_PENDING count towards capacity to prevent races
    const activeAllocationsCount = await tx.licenseAllocation.count({
      where: {
        entitlementId: entitlement.id,
        status: {
          in: [
            AllocationStatus.PENDING,
            AllocationStatus.ACTIVE,
            AllocationStatus.DEACTIVATION_PENDING,
          ],
        },
      },
    });

    if (activeAllocationsCount >= entitlement.max_activations) {
      throw new AllocationEngineError(
        `Allocation capacity reached: entitlement maxActivations limit is ${entitlement.max_activations} (active: ${activeAllocationsCount})`,
        409,
      );
    }

    // 7. Duplicate non-terminal allocation check under same entitlement
    const existingForEntitlement = await tx.licenseAllocation.findFirst({
      where: {
        entitlementId: entitlement.id,
        normalizedDomain: normalized,
        status: {
          in: [
            AllocationStatus.PENDING,
            AllocationStatus.ACTIVE,
            AllocationStatus.DEACTIVATION_PENDING,
          ],
        },
      },
    });

    if (existingForEntitlement) {
      throw new AllocationEngineError(
        `An allocation for domain '${normalized}' already exists under this entitlement with status ${existingForEntitlement.status}`,
        409,
      );
    }

    // 8. Find active license provider
    const provider = await tx.licenseProvider.findUnique({
      where: { code: providerCode },
    });

    if (!provider || provider.status !== "ACTIVE") {
      throw new AllocationEngineError(
        `License provider '${providerCode}' not found or inactive`,
        400,
      );
    }

    // 9. Check provider-wide active domain collision
    const existingActiveInProvider = await tx.licenseAllocation.findFirst({
      where: {
        providerId: provider.id,
        normalizedDomain: normalized,
        status: AllocationStatus.ACTIVE,
      },
    });

    if (existingActiveInProvider) {
      throw new AllocationEngineError(
        `Domain '${normalized}' is already actively allocated under provider ${providerCode}`,
        409,
      );
    }

    // 10. Create allocation in PENDING status
    const allocation = await tx.licenseAllocation.create({
      data: {
        entitlementId: entitlement.id,
        providerId: provider.id,
        userId: params.userId,
        domain: params.domain.trim(),
        normalizedDomain: normalized,
        status: AllocationStatus.PENDING,
        metadata: params.metadata || {},
      },
    });

    // 11. Record transactional audit log
    await tx.auditLog.create({
      data: {
        action: "ALLOCATION_REQUESTED",
        entity: "LicenseAllocation",
        entityId: allocation.id,
        actorId: params.userId,
        details: {
          entitlementId: entitlement.id,
          domain: params.domain.trim(),
          normalizedDomain: normalized,
          providerCode,
          providerId: provider.id,
        },
      },
    });

    return allocation;
  });
}

/**
 * Admin manual confirmation of external activation.
 * Concurrency-safe: locks ProviderAccount row FOR UPDATE to verify capacity strictly.
 */
export async function adminActivateAllocation(
  params: AdminActivateAllocationParams,
  db: PrismaClient = prisma,
) {
  return db.$transaction(async (tx) => {
    // 1. Lock Allocation row FOR UPDATE
    const lockedAllocations = await tx.$queryRaw<Array<{
      id: string;
      entitlement_id: string;
      provider_id: string;
      provider_account_id: string | null;
      user_id: string;
      domain: string;
      normalized_domain: string;
      status: AllocationStatus;
      metadata: any;
    }>>`
      SELECT id, entitlement_id, provider_id, provider_account_id, user_id, domain, normalized_domain, status, metadata
      FROM license_allocations
      WHERE id = ${params.allocationId}
      FOR UPDATE
    `;

    if (!lockedAllocations || lockedAllocations.length === 0) {
      throw new AllocationEngineError("Allocation not found", 404);
    }

    const allocation = lockedAllocations[0];

    // CAS check: only PENDING allocations can transition to ACTIVE
    if (allocation.status === AllocationStatus.ACTIVE) {
      throw new AllocationEngineError("Allocation is already active", 409);
    }

    if (allocation.status !== AllocationStatus.PENDING) {
      throw new AllocationEngineError(
        `Invalid state transition: cannot activate allocation in status ${allocation.status}`,
        409,
      );
    }

    // 2. Validate parent entitlement is still active
    const entitlement = await tx.entitlement.findUnique({
      where: { id: allocation.entitlement_id },
    });

    if (!entitlement || entitlement.status !== EntitlementStatus.ACTIVE) {
      throw new AllocationEngineError(
        `Cannot activate allocation: Parent entitlement is not active (${entitlement?.status || "NOT_FOUND"})`,
        409,
      );
    }

    if (entitlement.expiresAt && new Date(entitlement.expiresAt) < new Date()) {
      throw new AllocationEngineError(
        "Cannot activate allocation: Parent entitlement has expired",
        409,
      );
    }

    // 3. Lock ProviderAccount row FOR UPDATE
    const lockedAccounts = await tx.$queryRaw<Array<{
      id: string;
      provider_id: string;
      name: string;
      total_capacity: number;
      status: ProviderAccountStatus;
    }>>`
      SELECT id, provider_id, name, total_capacity, status
      FROM provider_accounts
      WHERE id = ${params.providerAccountId}
      FOR UPDATE
    `;

    if (!lockedAccounts || lockedAccounts.length === 0) {
      throw new AllocationEngineError("Provider account not found", 404);
    }

    const account = lockedAccounts[0];

    if (account.status !== ProviderAccountStatus.ACTIVE) {
      throw new AllocationEngineError(
        `Provider account is not active (status: ${account.status})`,
        409,
      );
    }

    if (account.provider_id !== allocation.provider_id) {
      throw new AllocationEngineError(
        "Provider account does not belong to the required license provider",
        400,
      );
    }

    // 4. Count current ACTIVE allocations on this provider account
    const activeOnAccount = await tx.licenseAllocation.count({
      where: {
        providerAccountId: account.id,
        status: AllocationStatus.ACTIVE,
      },
    });

    if (activeOnAccount >= account.total_capacity) {
      // Mark account as EXHAUSTED if not already
      await tx.providerAccount.update({
        where: { id: account.id },
        data: { status: ProviderAccountStatus.EXHAUSTED },
      });
      throw new AllocationEngineError(
        `Provider account capacity exhausted: total capacity is ${account.total_capacity} (active: ${activeOnAccount})`,
        409,
      );
    }

    // 5. Provider-wide duplicate active check
    const existingActive = await tx.licenseAllocation.findFirst({
      where: {
        providerId: allocation.provider_id,
        normalizedDomain: allocation.normalized_domain,
        status: AllocationStatus.ACTIVE,
        id: { not: allocation.id },
      },
    });

    if (existingActive) {
      throw new AllocationEngineError(
        `Domain '${allocation.normalized_domain}' is already active under this provider (allocation: ${existingActive.id})`,
        409,
      );
    }

    // 6. Transition to ACTIVE
    const updatedMetadata = {
      ...(typeof allocation.metadata === "object" && allocation.metadata !== null
        ? allocation.metadata
        : {}),
      ...(params.metadata || {}),
      ...(params.notes ? { adminActivationNotes: params.notes } : {}),
      fulfillmentMode: "MANUAL_EXTERNAL",
    };

    const updated = await tx.licenseAllocation.update({
      where: { id: allocation.id },
      data: {
        status: AllocationStatus.ACTIVE,
        providerAccountId: account.id,
        activatedAt: new Date(),
        metadata: updatedMetadata,
      },
    });

    // If this activation filled the last seat, update account status to EXHAUSTED
    if (activeOnAccount + 1 >= account.total_capacity) {
      await tx.providerAccount.update({
        where: { id: account.id },
        data: { status: ProviderAccountStatus.EXHAUSTED },
      });
    }

    // 7. Audit log in same transaction
    await tx.auditLog.create({
      data: {
        action: "ALLOCATION_ACTIVATED",
        entity: "LicenseAllocation",
        entityId: allocation.id,
        actorId: params.actorId,
        details: {
          entitlementId: allocation.entitlement_id,
          providerAccountId: account.id,
          normalizedDomain: allocation.normalized_domain,
          notes: params.notes,
          fulfillmentMode: "MANUAL_EXTERNAL",
        },
      },
    });

    return updated;
  });
}

/**
 * Admin rejects allocation request.
 */
export async function adminRejectAllocation(
  params: AdminRejectAllocationParams,
  db: PrismaClient = prisma,
) {
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{
      id: string;
      entitlement_id: string;
      status: AllocationStatus;
      metadata: any;
    }>>`
      SELECT id, entitlement_id, status, metadata
      FROM license_allocations
      WHERE id = ${params.allocationId}
      FOR UPDATE
    `;

    if (!locked || locked.length === 0) {
      throw new AllocationEngineError("Allocation not found", 404);
    }

    const allocation = locked[0];

    if (allocation.status !== AllocationStatus.PENDING) {
      throw new AllocationEngineError(
        `Invalid state transition: cannot reject allocation in status ${allocation.status}`,
        409,
      );
    }

    const updatedMetadata = {
      ...(typeof allocation.metadata === "object" && allocation.metadata !== null
        ? allocation.metadata
        : {}),
      ...(params.metadata || {}),
      rejectionReason: params.reason,
    };

    const updated = await tx.licenseAllocation.update({
      where: { id: allocation.id },
      data: {
        status: AllocationStatus.REJECTED,
        metadata: updatedMetadata,
      },
    });

    await tx.auditLog.create({
      data: {
        action: "ALLOCATION_REJECTED",
        entity: "LicenseAllocation",
        entityId: allocation.id,
        actorId: params.actorId,
        details: {
          entitlementId: allocation.entitlement_id,
          reason: params.reason,
        },
      },
    });

    return updated;
  });
}

/**
 * Customer or Admin requests deactivation of an ACTIVE allocation.
 * Transitions ACTIVE -> DEACTIVATION_PENDING.
 */
export async function requestAllocationDeactivation(
  params: RequestDeactivationParams,
  db: PrismaClient = prisma,
) {
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{
      id: string;
      entitlement_id: string;
      user_id: string;
      normalized_domain: string;
      status: AllocationStatus;
      metadata: any;
    }>>`
      SELECT id, entitlement_id, user_id, normalized_domain, status, metadata
      FROM license_allocations
      WHERE id = ${params.allocationId}
      FOR UPDATE
    `;

    if (!locked || locked.length === 0) {
      throw new AllocationEngineError("Allocation not found", 404);
    }

    const allocation = locked[0];

    if (params.isCustomer && allocation.user_id !== params.actorId) {
      throw new AllocationEngineError(
        "Forbidden: You do not own this allocation",
        403,
      );
    }

    if (allocation.status !== AllocationStatus.ACTIVE) {
      throw new AllocationEngineError(
        `Invalid state transition: cannot request deactivation for allocation in status ${allocation.status}`,
        409,
      );
    }

    const updatedMetadata = {
      ...(typeof allocation.metadata === "object" && allocation.metadata !== null
        ? allocation.metadata
        : {}),
      deactivationRequestedBy: params.actorId,
      deactivationReason: params.reason || null,
      deactivationRequestedAt: new Date().toISOString(),
    };

    const updated = await tx.licenseAllocation.update({
      where: { id: allocation.id },
      data: {
        status: AllocationStatus.DEACTIVATION_PENDING,
        metadata: updatedMetadata,
      },
    });

    await tx.auditLog.create({
      data: {
        action: "ALLOCATION_DEACTIVATION_REQUESTED",
        entity: "LicenseAllocation",
        entityId: allocation.id,
        actorId: params.actorId,
        details: {
          entitlementId: allocation.entitlement_id,
          normalizedDomain: allocation.normalized_domain,
          reason: params.reason,
        },
      },
    });

    return updated;
  });
}

/**
 * Admin confirms external deactivation.
 * Transitions DEACTIVATION_PENDING -> DEACTIVATED.
 * Frees upstream capacity.
 */
export async function adminConfirmDeactivated(
  params: AdminConfirmDeactivatedParams,
  db: PrismaClient = prisma,
) {
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{
      id: string;
      entitlement_id: string;
      provider_account_id: string | null;
      normalized_domain: string;
      status: AllocationStatus;
      metadata: any;
    }>>`
      SELECT id, entitlement_id, provider_account_id, normalized_domain, status, metadata
      FROM license_allocations
      WHERE id = ${params.allocationId}
      FOR UPDATE
    `;

    if (!locked || locked.length === 0) {
      throw new AllocationEngineError("Allocation not found", 404);
    }

    const allocation = locked[0];

    if (allocation.status !== AllocationStatus.DEACTIVATION_PENDING) {
      throw new AllocationEngineError(
        `Invalid state transition: cannot confirm deactivation for allocation in status ${allocation.status}`,
        409,
      );
    }

    const updatedMetadata = {
      ...(typeof allocation.metadata === "object" && allocation.metadata !== null
        ? allocation.metadata
        : {}),
      ...(params.metadata || {}),
      adminDeactivationNotes: params.notes || null,
      deactivatedBy: params.actorId,
    };

    const updated = await tx.licenseAllocation.update({
      where: { id: allocation.id },
      data: {
        status: AllocationStatus.DEACTIVATED,
        deactivatedAt: new Date(),
        metadata: updatedMetadata,
      },
    });

    // If provider account was EXHAUSTED, restore to ACTIVE if capacity is now available
    if (allocation.provider_account_id) {
      const account = await tx.providerAccount.findUnique({
        where: { id: allocation.provider_account_id },
      });

      if (account && account.status === ProviderAccountStatus.EXHAUSTED) {
        const remainingActive = await tx.licenseAllocation.count({
          where: {
            providerAccountId: account.id,
            status: AllocationStatus.ACTIVE,
          },
        });

        if (remainingActive < account.totalCapacity) {
          await tx.providerAccount.update({
            where: { id: account.id },
            data: { status: ProviderAccountStatus.ACTIVE },
          });
        }
      }
    }

    await tx.auditLog.create({
      data: {
        action: "ALLOCATION_DEACTIVATED",
        entity: "LicenseAllocation",
        entityId: allocation.id,
        actorId: params.actorId,
        details: {
          entitlementId: allocation.entitlement_id,
          providerAccountId: allocation.provider_account_id,
          normalizedDomain: allocation.normalized_domain,
          notes: params.notes,
        },
      },
    });

    return updated;
  });
}

/**
 * Worker reconciliation function:
 * Sweeps ACTIVE allocations whose parent Entitlement is REVOKED or EXPIRED.
 * Transitions ACTIVE -> DEACTIVATION_PENDING.
 * Safe for concurrent workers via FOR UPDATE SKIP LOCKED.
 */
export async function reconcileExternalAllocations(
  params?: ReconcileExternalAllocationsParams,
  db: PrismaClient = prisma,
): Promise<{ transitionedCount: number; allocationIds: string[] }> {
  const batchSize = params?.batchSize || 100;
  const workerId = params?.workerId || "worker-default";

  return db.$transaction(async (tx) => {
    // Select ACTIVE allocations on terminal (REVOKED / EXPIRED) entitlements
    const candidateRows = await tx.$queryRaw<Array<{
      id: string;
      entitlement_id: string;
      provider_account_id: string | null;
      normalized_domain: string;
      entitlement_status: EntitlementStatus;
    }>>`
      SELECT a.id, a.entitlement_id, a.provider_account_id, a.normalized_domain, e.status as entitlement_status
      FROM license_allocations a
      JOIN entitlements e ON a.entitlement_id = e.id
      WHERE a.status = 'ACTIVE'
        AND e.status IN ('REVOKED', 'EXPIRED')
      LIMIT ${batchSize}
      FOR UPDATE OF a SKIP LOCKED
    `;

    if (!candidateRows || candidateRows.length === 0) {
      return { transitionedCount: 0, allocationIds: [] };
    }

    const allocationIds = candidateRows.map((r) => r.id);

    // Transition all selected allocations to DEACTIVATION_PENDING
    await tx.licenseAllocation.updateMany({
      where: { id: { in: allocationIds } },
      data: { status: AllocationStatus.DEACTIVATION_PENDING },
    });

    // Record audit log for each transitioned allocation
    for (const row of candidateRows) {
      await tx.auditLog.create({
        data: {
          action: "ALLOCATION_DEACTIVATION_REQUIRED",
          entity: "LicenseAllocation",
          entityId: row.id,
          actorId: null, // System event
          details: {
            entitlementId: row.entitlement_id,
            entitlementStatus: row.entitlement_status,
            providerAccountId: row.provider_account_id,
            normalizedDomain: row.normalized_domain,
            workerId,
            reason: `Parent entitlement transitioned to ${row.entitlement_status}`,
          },
        },
      });
    }

    return {
      transitionedCount: candidateRows.length,
      allocationIds,
    };
  });
}
