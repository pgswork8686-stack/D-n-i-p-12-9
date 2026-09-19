import {
  prisma,
  claimDueAutomationJobs,
  ClaimedAutomationJob,
  AutomationJobStatus,
  AutomationDeliveryStatus,
} from "@nexus/database";
import { signAutomationPayload, validateTrustedOrigin } from "@nexus/utils";

export interface AutomationDispatcherOptions {
  batchSize?: number;
  workerId?: string;
  leaseMinutes?: number;
}

export function sanitizeErrorMessage(msg?: string): string {
  if (!msg) return "Unknown error";
  return msg
    .replace(/(postgres(?:ql)?|redis|s3|https?):\/\/[^\s@]+@/gi, "$1://***:***@")
    .replace(/(secret|token|password|key)=([^\s&]+)/gi, "$1=[REDACTED]")
    .substring(0, 1000);
}

export function resolveAutomationServiceSecret(): string {
  const secret = process.env.AUTOMATION_SERVICE_SECRET;
  const isProduction = process.env.NODE_ENV === "production";

  if (!secret || secret.trim() === "") {
    if (isProduction) {
      throw new Error(
        "Missing required AUTOMATION_SERVICE_SECRET in production",
      );
    }
    return "";
  }

  if (isProduction) {
    const lower = secret.toLowerCase();
    if (
      lower === "placeholder" ||
      lower === "changeme" ||
      lower === "secret" ||
      lower.includes("placeholder") ||
      secret.length < 32
    ) {
      throw new Error(
        "Insecure AUTOMATION_SERVICE_SECRET in production: minimum 32 chars required and cannot be a placeholder",
      );
    }
  }

  return secret.trim();
}

/**
 * Resolves the target n8n webhook URL for a given job type.
 * Supports multi-route dispatch per job type or base URL route mapping.
 */
export function resolveWebhookUrlForJobType(jobType: string): string | null {
  let specificUrl: string | undefined;
  if (jobType === "CMS_AI_DRAFT") {
    specificUrl = process.env.N8N_CMS_AI_DRAFT_WEBHOOK_URL;
  } else if (jobType === "ORDER_PAID_EMAIL") {
    specificUrl = process.env.N8N_ORDER_PAID_EMAIL_WEBHOOK_URL;
  } else if (jobType === "LICENSE_PROVISIONED_EMAIL") {
    specificUrl = process.env.N8N_LICENSE_PROVISIONED_EMAIL_WEBHOOK_URL;
  }

  const baseUrl =
    process.env.N8N_WEBHOOK_BASE_URL ||
    process.env.N8N_AUTOMATION_WEBHOOK_URL;

  let candidateUrl = specificUrl;
  if (!candidateUrl && baseUrl) {
    const trimmedBase = baseUrl.trim().replace(/\/+$/, "");
    if (jobType === "CMS_AI_DRAFT") {
      candidateUrl = `${trimmedBase}/webhook/cms-ai-draft`;
    } else if (jobType === "ORDER_PAID_EMAIL") {
      candidateUrl = `${trimmedBase}/webhook/order-paid-email`;
    } else if (jobType === "LICENSE_PROVISIONED_EMAIL") {
      candidateUrl = `${trimmedBase}/webhook/license-provisioned-email`;
    } else {
      candidateUrl = baseUrl;
    }
  }

  if (!candidateUrl || candidateUrl.trim() === "") {
    const isProduction = process.env.NODE_ENV === "production";
    if (isProduction) {
      throw new Error(
        `Missing required automation webhook URL for job type '${jobType}' in production`,
      );
    }
    return null;
  }

  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction) {
    try {
      validateTrustedOrigin(candidateUrl, `WEBHOOK_URL_${jobType}`, true);
    } catch (err: any) {
      throw new Error(
        `Insecure automation webhook URL for job type '${jobType}' in production: ${err.message}`,
      );
    }
  }

  return candidateUrl.trim();
}

export function resolveN8nWebhookUrl(jobType?: string): string | null {
  if (jobType) {
    return resolveWebhookUrlForJobType(jobType);
  }
  const url =
    process.env.N8N_AUTOMATION_WEBHOOK_URL ||
    process.env.N8N_WEBHOOK_BASE_URL;
  if (!url || url.trim() === "") {
    return null;
  }

  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction) {
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
  const path = new URL(webhookUrl).pathname;
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
    "X-Nexus-Signature-Version": "v1",
  };

  if (secret) {
    headers["X-Nexus-Signature"] = signAutomationPayload({
      service: "worker",
      method: "POST",
      path,
      timestamp,
      requestId,
      body,
      secret,
    });
  }

  // Delivery Lifecycle: Transition associated delivery to SENDING upon dispatch attempt
  const deliveryId = (job.payloadJson as any)?.deliveryId;
  if (deliveryId) {
    try {
      await prisma.automationDelivery.update({
        where: { id: deliveryId },
        data: { status: AutomationDeliveryStatus.SENDING },
      });
    } catch {
      // delivery record might not exist for some job types
    }
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
    const rawErrorText = await res.text().catch(() => `HTTP ${res.status}`);
    const sanitizedErrorText = sanitizeErrorMessage(rawErrorText);

    return {
      success: false,
      error: `n8n webhook failed [${res.status}]: ${sanitizedErrorText.substring(0, 200)} (retryable=${isRetryable})`,
    };
  } catch (netErr: any) {
    const sanitizedNetErr = sanitizeErrorMessage(
      netErr.message || String(netErr),
    );
    return {
      success: false,
      error: `n8n webhook network error: ${sanitizedNetErr} (retryable=true)`,
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

  let secret: string;
  try {
    secret = resolveAutomationServiceSecret();
  } catch (secErr: any) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "worker",
        event: "automation_secret_invalid",
        error: secErr.message,
      }),
    );
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

  let dispatchedCount = 0;

  for (const job of claimedJobs) {
    let webhookUrl: string | null = null;
    try {
      webhookUrl = resolveWebhookUrlForJobType(job.type);
    } catch (urlErr: any) {
      console.error(
        JSON.stringify({
          level: "error",
          service: "worker",
          event: "webhook_url_resolution_failed",
          jobId: job.id,
          jobType: job.type,
          error: urlErr.message,
        }),
      );
    }

    if (!webhookUrl) {
      // In development/test without configured webhook URL for this type, skip dispatch
      continue;
    }

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
      const sanitizedError = sanitizeErrorMessage(result.error);

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
            lastErrorMessage: sanitizedError,
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
            lastErrorMessage: sanitizedError,
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
          error: sanitizedError,
          canRetry,
          timestamp: new Date().toISOString(),
        }),
      );
    }
  }

  return { claimedCount: claimedJobs.length, dispatchedCount };
}
