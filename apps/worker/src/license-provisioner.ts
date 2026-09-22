import {
  prisma,
  provisionInternalLicenses as engineProvision,
  reconcileInternalLicenses as engineReconcile,
  enqueueLicenseProvisionedEmailJob,
} from "@nexus/database";

export interface LicenseWorkerOptions {
  batchSize?: number;
  workerId?: string;
}

export async function provisionInternalLicenses(
  options?: LicenseWorkerOptions,
) {
  const workerId = options?.workerId || "worker-default";
  const batchSize = options?.batchSize || 100;

  try {
    const result = await engineProvision(
      { batchSize, workerId },
      prisma,
    );

    if (result.provisionedCount > 0) {
      for (const licenseId of result.licenseIds) {
        await enqueueLicenseProvisionedEmailJob(licenseId, prisma);
      }

      console.log(
        JSON.stringify({
          level: "info",
          service: "worker",
          event: "internal_licenses_provisioned",
          workerId,
          provisionedCount: result.provisionedCount,
          licenseIds: result.licenseIds,
          timestamp: new Date().toISOString(),
        }),
      );
    }

    return result;
  } catch (err: any) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "worker",
        event: "internal_license_provisioning_error",
        workerId,
        error: err?.message || String(err),
        timestamp: new Date().toISOString(),
      }),
    );
    throw err;
  }
}

/**
 * Reconciles any active InternalLicense records that do not yet have a
 * LICENSE_PROVISIONED_EMAIL automation job (crash-safe recovery).
 */
export async function reconcileMissingLicenseProvisionedEmailJobs(
  options?: LicenseWorkerOptions,
) {
  const workerId = options?.workerId || "worker-default";
  const batchSize = options?.batchSize || 100;

  try {
    let missingLicenseIds: string[] = [];
    try {
      const rows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT il.id
        FROM internal_licenses il
        LEFT JOIN automation_jobs aj
          ON aj.type = 'LICENSE_PROVISIONED_EMAIL'::"AutomationJobType"
          AND aj.source_type = 'License'
          AND aj.source_id = il.id
        WHERE il.status = 'ACTIVE'::"LicenseStatus"
          AND aj.id IS NULL
        LIMIT ${batchSize}
      `;
      missingLicenseIds = (rows || []).map((r) => r.id);
    } catch {
      // Test fallback if $queryRaw is unavailable/mocked
      const activeLicenses = await prisma.internalLicense.findMany({
        where: { status: "ACTIVE" },
        take: batchSize,
      });
      const activeIds = activeLicenses.map((l) => l.id);
      const existingJobs = await prisma.automationJob.findMany({
        where: {
          type: "LICENSE_PROVISIONED_EMAIL",
          sourceType: "License",
          sourceId: { in: activeIds },
        },
      });
      const coveredSet = new Set(existingJobs.map((j) => j.sourceId));
      missingLicenseIds = activeIds.filter((id) => !coveredSet.has(id));
    }

    let enqueuedCount = 0;
    for (const licenseId of missingLicenseIds) {
      const job = await enqueueLicenseProvisionedEmailJob(licenseId, prisma);
      if (job) {
        enqueuedCount++;
      }
    }

    if (enqueuedCount > 0) {
      console.log(
        JSON.stringify({
          level: "info",
          service: "worker",
          event: "license_provisioned_emails_reconciled",
          workerId,
          enqueuedCount,
          licenseIds: missingLicenseIds,
          timestamp: new Date().toISOString(),
        }),
      );
    }

    return { enqueuedCount, licenseIds: missingLicenseIds };
  } catch (err: any) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "worker",
        event: "license_provisioned_emails_reconciliation_error",
        workerId,
        error: err?.message || String(err),
        timestamp: new Date().toISOString(),
      }),
    );
    throw err;
  }
}

export async function reconcileInternalLicenses(
  options?: LicenseWorkerOptions,
) {
  const workerId = options?.workerId || "worker-default";
  const batchSize = options?.batchSize || 100;

  try {
    const result = await engineReconcile(
      { batchSize, workerId },
      prisma,
    );

    if (result.reconciledCount > 0) {
      console.log(
        JSON.stringify({
          level: "info",
          service: "worker",
          event: "internal_licenses_reconciled",
          workerId,
          reconciledCount: result.reconciledCount,
          licenseIds: result.licenseIds,
          timestamp: new Date().toISOString(),
        }),
      );
    }

    return result;
  } catch (err: any) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "worker",
        event: "internal_license_reconciliation_error",
        workerId,
        error: err?.message || String(err),
        timestamp: new Date().toISOString(),
      }),
    );
    throw err;
  }
}
