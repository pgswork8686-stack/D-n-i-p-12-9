import { Job } from "bullmq";
import { SystemJobPayload, SystemJobResult } from "@nexus/contracts";

export async function processSystemJob(
  job: Job<SystemJobPayload>,
): Promise<SystemJobResult> {
  const correlationId = job.data?.correlationId || "unknown";
  const type = job.name || job.data?.type || "unknown";
  const jobId = String(job.id || job.data?.jobId || "unknown");

  // Output structured log matching Issue #5 specifications
  console.log(
    JSON.stringify({
      level: "info",
      service: "worker",
      event: "job_started",
      jobId,
      type,
      correlationId,
      timestamp: new Date().toISOString(),
    }),
  );

  // Simulate work (e.g. system heartbeat, cache invalidation, test ping)
  const result: SystemJobResult = {
    success: true,
    jobId,
    processedAt: new Date().toISOString(),
  };

  console.log(
    JSON.stringify({
      level: "info",
      service: "worker",
      event: "job_completed",
      jobId,
      type,
      correlationId,
      timestamp: result.processedAt,
    }),
  );

  return result;
}
