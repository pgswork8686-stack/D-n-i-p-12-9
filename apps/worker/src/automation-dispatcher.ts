import {
  prisma,
  claimDueAutomationJobs,
  ClaimedAutomationJob,
  AutomationJobStatus,
  AutomationDeliveryStatus,
  AutomationJobType,
} from "@nexus/database";
import {
  signAutomationPayload,
  validateTrustedOrigin,
  resolveAutomationServiceSecret,
} from "@nexus/utils";

// Re-export for backwards compatibility; the authoritative implementation
// lives in @nexus/utils so worker and API share the exact same policy.
export { resolveAutomationServiceSecret };

export interface AutomationDispatcherOptions {
  batchSize?: number;
  workerId?: string;
  leaseMinutes?: number;
}

/**
 * Phase12 V1 supported automation job types with committed n8n workflows.
 * EXTERNAL_ALLOCATION_EMAIL is intentionally UNSUPPORTED in Phase12 V1:
 * there is no committed workflow, so jobs of this type are never routed
 * (fail-closed) and enqueueing/dispatching it is rejected.
 */
export const SUPPORTED_AUTOMATION_JOB_TYPES: ReadonlySet<string> = new Set([
  AutomationJobType.CMS_AI_DRAFT,
  AutomationJobType.ORDER_PAID_EMAIL,
  AutomationJobType.LICENSE_PROVISIONED_EMAIL,
]);

const WEBHOOK_PATH_BY_JOB_TYPE: Record<string, string> = {
  [AutomationJobType.CMS_AI_DRAFT]: "/webhook/cms-ai-draft",
  [AutomationJobType.ORDER_PAID_EMAIL]: "/webhook/order-paid-email",
  [AutomationJobType.LICENSE_PROVISIONED_EMAIL]:
    "/webhook/license-provisioned-email",
};


export function sanitizeErrorMessage(msg?: string): string {
  if (!msg) return "Unknown error";
  return msg
    .replace(/(postgres(?:ql)?|redis|s3|https?):\/\/[^\s@]+@/gi, "$1://***:***@")
    .replace(/(secret|token|password|key)=([^\s&]+)/gi, "$1=[REDACTED]")
    .substring(0, 1000);
}

/**
 * Resolves the target n8n webhook URL for a given job type.
 * STRICT route mapping: unknown/unsupported job types (including the
 * intentionally unsupported EXTERNAL_ALLOCATION_EMAIL) are rejected with a
 * controlled configuration error — never silently fallen back to a base URL.
 */
export function resolveWebhookUrlForJobType(jobType: string): string | null {
  const webhookPath = WEBHOOK_PATH_BY_JOB_TYPE[jobType];
  if (!webhookPath) {
    throw new Error(
      `Unsupported automation job type '${jobType}': no n8n route mapping is configured for this type in Phase12 V1`,
    );
  }

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
    candidateUrl = `${trimmedBase}${webhookPath}`;
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

  // Pre-claim route validation (Phase 12 Round 3, §22): validate configured
  // routes for all supported, enabled job types BEFORE claiming anything.
  // A job type may be intentionally disabled via N8N_DISABLED_JOB_TYPES
  // (comma-separated); disabled types are excluded from processing entirely.
  const routeCheck = validateAutomationRoutes();
  if (!routeCheck.valid) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "worker",
        event: "automation_routes_invalid",
        missingRoutes: routeCheck.missing,
        disabledTypes: routeCheck.disabled,
        action: "skipping_claim_cycle",
      }),
    );
    return { claimedCount: 0, dispatchedCount: 0 };
  }

  const disabledTypes = new Set(routeCheck.disabled);
  const allowedTypes = Array.from(SUPPORTED_AUTOMATION_JOB_TYPES).filter(
    (t) => !disabledTypes.has(t),
  ) as AutomationJobType[];

  const claimedJobs = await claimDueAutomationJobs({
    limit: batchSize,
    workerId,
    leaseMinutes,
    allowedTypes,
  });

  if (!claimedJobs || claimedJobs.length === 0) {
    return { claimedCount: 0, dispatchedCount: 0 };
  }

  // Defense in depth: never dispatch a disabled or unsupported type even if
  // it somehow got claimed (enqueue-side guard is the primary control).
  const dispatchableJobs = claimedJobs.filter(
    (j) =>
      !disabledTypes.has(j.type) && SUPPORTED_AUTOMATION_JOB_TYPES.has(j.type),
  );

  console.log(
    JSON.stringify({
      level: "info",
      service: "worker",
      event: "automation_jobs_claimed",
      workerId,
      count: dispatchableJobs.length,
      jobIds: dispatchableJobs.map((j) => j.id),
      timestamp: new Date().toISOString(),
    }),
  );

  let dispatchedCount = 0;

  for (const job of dispatchableJobs) {
    let webhookUrl: string | null = null;
    try {
      webhookUrl = resolveWebhookUrlForJobType(job.type);
    } catch (urlErr: any) {
      // Controlled unsupported-route configuration error (§24): settle the
      // claimed job coherently instead of leaving it stranded in RUNNING
      // until lease expiry.
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
      await failClaimedJobForRouteConfiguration(job, urlErr.message);
      continue;
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
        // Delivery lifecycle (§26): a retryable dispatch failure returns the
        // delivery to PENDING. Never leave it SENDING.
        await settleDeliveryAfterDispatchFailure(job, false);
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
        // Delivery lifecycle (§27): terminal dispatch failure marks the
        // delivery FAILED alongside the job.
        await settleDeliveryAfterDispatchFailure(job, true);
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

/**
 * Route-configuration failure on an already-claimed job (§21/§25): settle
 * job FAILED + delivery FAILED with error metadata, instead of leaving the
 * freshly claimed job stranded in RUNNING until lease expiry.
 */
export async function failClaimedJobForRouteConfiguration(
  job: ClaimedAutomationJob,
  reason: string,
): Promise<void> {
  const sanitizedError = sanitizeErrorMessage(reason);
  try {
    await prisma.automationDelivery.updateMany({
      where: { jobId: job.id },
      data: { status: AutomationDeliveryStatus.FAILED },
    });
  } catch {
    // delivery record might not exist for some job types
  }
  await prisma.automationJob.update({
    where: { id: job.id },
    data: {
      status: AutomationJobStatus.FAILED,
      completedAt: new Date(),
      leaseUntil: null,
      lastErrorCode: "ROUTE_UNCONFIGURED",
      lastErrorMessage: sanitizedError,
    },
  });
}

/**
 * Delivery lifecycle settlement after a failed dispatch attempt (§26/§27):
 *  - retryable failure  -> delivery returns to PENDING (never left SENDING)
 *  - terminal failure   -> delivery marked FAILED
 */
export async function settleDeliveryAfterDispatchFailure(
  job: ClaimedAutomationJob,
  terminal: boolean,
): Promise<void> {
  const deliveryId = (job.payloadJson as any)?.deliveryId;
  if (!deliveryId) {
    return;
  }
  try {
    await prisma.automationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: terminal
          ? AutomationDeliveryStatus.FAILED
          : AutomationDeliveryStatus.PENDING,
      },
    });
  } catch {
    // delivery record might not exist for some job types
  }
}

export interface AutomationRouteValidationResult {
  valid: boolean;
  /** Supported + enabled job types whose n8n route cannot be resolved. */
  missing: string[];
  /** Job types explicitly disabled via N8N_DISABLED_JOB_TYPES. */
  disabled: string[];
}

/**
 * Reads explicitly disabled automation job types (§22).
 * N8N_DISABLED_JOB_TYPES is a comma-separated list, e.g. "ORDER_PAID_EMAIL".
 */
export function getDisabledAutomationJobTypes(): Set<string> {
  const raw = process.env.N8N_DISABLED_JOB_TYPES || "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  );
}

/**
 * Pre-claim validation (§5/§22): every supported job type that is not
 * explicitly disabled must have a resolvable n8n webhook route.
 * Misconfiguration is reported BEFORE any claim so nothing can be stranded
 * in RUNNING because of a configuration error discovered after the claim.
 */
export function validateAutomationRoutes(): AutomationRouteValidationResult {
  const disabled = getDisabledAutomationJobTypes();
  const missing: string[] = [];
  for (const type of SUPPORTED_AUTOMATION_JOB_TYPES) {
    if (disabled.has(type)) continue;
    try {
      const url = resolveWebhookUrlForJobType(type);
      if (!url) {
        missing.push(type);
      }
    } catch {
      missing.push(type);
    }
  }
  return {
    valid: missing.length === 0,
    missing,
    disabled: Array.from(disabled),
  };
}
