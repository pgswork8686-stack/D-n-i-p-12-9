import {
  prisma,
  claimDueAutomationJobs,
  ClaimedAutomationJob,
  AutomationJobStatus,
} from "@nexus/database";
import { signAutomationPayload, validateTrustedOrigin } from "@nexus/utils";

export interface AutomationDispatcherOptions {
  batchSize?: number;
  workerId?: string;
  leaseMinutes?: number;
}

export function resolveN8nWebhookUrl(): string | null {
  const url = process.env.N8N_AUTOMATION_WEBHOOK_URL;
  if (!url || url.trim() === "") {
    return null;
  }

  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction) {
    // Enforce production HTTPS and block localhost / private IPs
    try {
      validateTrustedOrigin(url, "N8N_AUTOMATION_WEBHOOK_URL", true);
    } catch (err: any) {
      throw new Error(
        `Insecure N8N_AUTOMATION_WEBHOOK_URL in production: ${err.message}`,
      );
    }
  }

  return url.trim();
}

/**
 * Dispatches a single automation job to the n8n webhook.
 */
export async function dispatchSingleAutomationJob(
  job: ClaimedAutomationJob,
  webhookUrl: string,
  secret?: string,
): Promise<{ success: boolean; error?: string }> {
  const timestamp = Date.now().toString();
  const requestId = `dispatch-${job.id}-${Date.now()}`;
  const body = {
    jobId: job.id,
    type: job.type,
    payload: job.payloadJson,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Nexus-Service": "worker",
    "X-Nexus-Timestamp": timestamp,
    "X-Nexus-Request-Id": requestId,
    "X-Nexus-Job-Id": job.id,
    "X-Nexus-Job-Type": job.type,
  };

  if (secret) {
    headers["X-Nexus-Signature"] = signAutomationPayload({
      method: "POST",
      path: new URL(webhookUrl).pathname,
      timestamp,
      requestId,
      body,
      secret,
    });
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (res.ok) {
      return { success: true };
    }

    const isRetryable = res.status === 429 || res.status >= 500;
    const errorText = await res.text().catch(() => `HTTP ${res.status}`);

    return {
      success: false,
      error: `n8n webhook failed [${res.status}]: ${errorText.substring(0, 200)} (retryable=${isRetryable})`,
    };
  } catch (netErr: any) {
    return {
      success: false,
      error: `n8n webhook network error: ${netErr.message || String(netErr)} (retryable=true)`,
    };
  }
}

/**
 * Claims pending or stale-running automation jobs atomically and dispatches them to n8n.
 */
export async function dispatchPendingAutomationJobs(
  options: AutomationDispatcherOptions = {},
): Promise<{ claimedCount: number; dispatchedCount: number }> {
  const workerId = options.workerId || "worker-default";
  const batchSize = options.batchSize || 10;
  const leaseMinutes = options.leaseMinutes || 5;

  let webhookUrl: string | null = null;
  try {
    webhookUrl = resolveN8nWebhookUrl();
  } catch (err: any) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "worker",
        event: "n8n_url_invalid",
        error: err.message,
      }),
    );
    return { claimedCount: 0, dispatchedCount: 0 };
  }

  if (!webhookUrl) {
    // In environments without configured n8n webhook, don't claim jobs
    return { claimedCount: 0, dispatchedCount: 0 };
  }

  const claimedJobs = await claimDueAutomationJobs({
    limit: batchSize,
    workerId,
    leaseMinutes,
  });

  if (!claimedJobs || claimedJobs.length === 0) {
    return { claimedCount: 0, dispatchedCount: 0 };
  }

  console.log(
    JSON.stringify({
      level: "info",
      service: "worker",
      event: "automation_jobs_claimed",
      workerId,
      count: claimedJobs.length,
      jobIds: claimedJobs.map((j) => j.id),
      timestamp: new Date().toISOString(),
    }),
  );

  const secret = process.env.AUTOMATION_SERVICE_SECRET;
  let dispatchedCount = 0;

  for (const job of claimedJobs) {
    const result = await dispatchSingleAutomationJob(job, webhookUrl, secret);

    if (result.success) {
      dispatchedCount++;
      console.log(
        JSON.stringify({
          level: "info",
          service: "worker",
          event: "automation_job_dispatched",
          jobId: job.id,
          jobType: job.type,
          timestamp: new Date().toISOString(),
        }),
      );
    } else {
      const isRetryable = result.error?.includes("retryable=true") ?? false;
      const canRetry = isRetryable && job.attemptCount < job.maxAttempts;

      if (canRetry) {
        const backoffSeconds =
          job.attemptCount === 1 ? 30 : job.attemptCount === 2 ? 120 : 600;
        await prisma.automationJob.update({
          where: { id: job.id },
          data: {
            status: AutomationJobStatus.PENDING,
            scheduledAt: new Date(Date.now() + backoffSeconds * 1000),
            leaseUntil: null,
            lastErrorCode: "DISPATCH_FAILED",
            lastErrorMessage: result.error,
          },
        });
      } else {
        await prisma.automationJob.update({
          where: { id: job.id },
          data: {
            status: AutomationJobStatus.FAILED,
            completedAt: new Date(),
            leaseUntil: null,
            lastErrorCode: "DISPATCH_FAILED",
            lastErrorMessage: result.error,
          },
        });
      }

      console.warn(
        JSON.stringify({
          level: "warn",
          service: "worker",
          event: "automation_job_dispatch_failed",
          jobId: job.id,
          jobType: job.type,
          error: result.error,
          canRetry,
          timestamp: new Date().toISOString(),
        }),
      );
    }
  }

  return { claimedCount: claimedJobs.length, dispatchedCount };
}
