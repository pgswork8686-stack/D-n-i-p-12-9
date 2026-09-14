import {
  prisma,
  reconcileExternalAllocations as engineReconcile,
} from "@nexus/database";

export interface ReconcileExternalAllocationsOptions {
  batchSize?: number;
  workerId?: string;
}

export async function reconcileExternalAllocations(
  options?: ReconcileExternalAllocationsOptions,
) {
  const workerId = options?.workerId || "worker-default";
  const batchSize = options?.batchSize || 100;

  try {
    const result = await engineReconcile(
      { batchSize, workerId },
      prisma,
    );

    if (result.transitionedCount > 0) {
      console.log(
        JSON.stringify({
          level: "info",
          service: "worker",
          event: "allocations_reconciled",
          workerId,
          transitionedCount: result.transitionedCount,
          allocationIds: result.allocationIds,
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
        event: "allocation_reconciliation_error",
        workerId,
        error: err?.message || String(err),
        timestamp: new Date().toISOString(),
      }),
    );
    throw err;
  }
}
