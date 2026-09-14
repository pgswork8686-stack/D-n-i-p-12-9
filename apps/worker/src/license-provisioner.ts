import {
  prisma,
  provisionInternalLicenses as engineProvision,
  reconcileInternalLicenses as engineReconcile,
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
