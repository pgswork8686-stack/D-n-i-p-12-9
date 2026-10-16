import * as crypto from "crypto";
import {
  prisma,
  Prisma,
  AutomationDeliveryStatus,
  AutomationJobStatus,
  AutomationJobType,
  NotificationType,
} from "@nexus/database";
import { ServiceInquiryCreatedPayload } from "@nexus/contracts";

/**
 * Handler for the SERVICE_INQUIRY_CREATED outbox event (written by the API in the same
 * transaction as the stored inquiry).
 *
 * Guarantees:
 *  - Idempotent: running it again for the same event creates no second notification, email job
 *    or audit row, so outbox retries and lease reclaims are safe.
 *  - The inquiry is already committed before this runs; nothing here can lose or roll it back.
 *  - In-app notifications go first and do not depend on email configuration. Email problems
 *    throw (so the outbox retries with back-off) only after in-app delivery succeeded.
 *  - Data minimisation: the event, notifications and email job carry the public reference, the
 *    service name and company name only, never the contact details or requirements text.
 */

export const NOTIFY_PERMISSION = "inquiry.read";
export const DEFAULT_MAX_STAFF_RECIPIENTS = 50;
export const DEFAULT_MAX_EMAIL_RECIPIENTS = 10;
export const DEFAULT_HOURLY_EMAIL_CAP = 30;

const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export interface ServiceInquiryNotifierConfig {
  /** Explicit mailbox list from SERVICE_INQUIRY_NOTIFY_EMAILS; empty disables email. */
  emails: string[];
  invalidEmails: number;
  maxStaff: number;
  hourlyEmailCap: number;
  /** Optional absolute admin origin used to build a link in the email. */
  adminBaseUrl: string | null;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function loadNotifierConfig(env: NodeJS.ProcessEnv = process.env): ServiceInquiryNotifierConfig {
  const seen = new Set<string>();
  let invalid = 0;
  for (const part of (env.SERVICE_INQUIRY_NOTIFY_EMAILS ?? "").split(/[,;\s]+/)) {
    const email = part.trim().toLowerCase();
    if (!email) continue;
    if (!EMAIL_PATTERN.test(email)) {
      invalid++;
      continue;
    }
    seen.add(email);
  }
  const maxEmails = positiveInt(env.SERVICE_INQUIRY_NOTIFY_MAX_EMAILS, DEFAULT_MAX_EMAIL_RECIPIENTS);
  let adminBaseUrl: string | null = null;
  const rawAdmin = env.ADMIN_PUBLIC_URL?.trim();
  if (rawAdmin) {
    try {
      const u = new URL(rawAdmin);
      if (u.protocol === "https:" || u.protocol === "http:") adminBaseUrl = u.origin;
    } catch {
      adminBaseUrl = null;
    }
  }
  return {
    emails: [...seen].slice(0, maxEmails),
    invalidEmails: invalid,
    maxStaff: positiveInt(env.SERVICE_INQUIRY_NOTIFY_MAX_STAFF, DEFAULT_MAX_STAFF_RECIPIENTS),
    hourlyEmailCap: positiveInt(env.SERVICE_INQUIRY_NOTIFY_HOURLY_EMAIL_CAP, DEFAULT_HOURLY_EMAIL_CAP),
    adminBaseUrl,
  };
}

export interface ServiceInquiryNotifyResult {
  handled: boolean;
  skipped?: "INQUIRY_NOT_FOUND";
  staffNotified: number;
  emailJobsQueued: number;
  emailSuppressedByCap: boolean;
}

function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown>) {
  const line = JSON.stringify({ level, service: "worker", event, ...fields, timestamp: new Date().toISOString() });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

function emailHash(email: string): string {
  return crypto.createHash("sha256").update(email).digest("hex").slice(0, 16);
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function processServiceInquiryCreatedEvent(
  payload: unknown,
  workerId = "worker-default",
  config: ServiceInquiryNotifierConfig = loadNotifierConfig(),
): Promise<ServiceInquiryNotifyResult> {
  const p = (payload ?? {}) as Partial<ServiceInquiryCreatedPayload>;
  if (!p.inquiryId || typeof p.inquiryId !== "string") {
    throw new Error("SERVICE_INQUIRY_CREATED payload is missing inquiryId");
  }

  // The payload is only a pointer: re-read the authoritative row.
  const inquiry = await prisma.serviceInquiry.findUnique({
    where: { id: p.inquiryId },
    select: { id: true, inquiryNumber: true, companyName: true, service: { select: { name: true } } },
  });
  if (!inquiry) {
    // Nothing to notify about (row removed); retrying cannot help.
    log("warn", "service_inquiry_notify_skipped", { workerId, inquiryId: p.inquiryId, reason: "INQUIRY_NOT_FOUND" });
    return { handled: true, skipped: "INQUIRY_NOT_FOUND", staffNotified: 0, emailJobsQueued: 0, emailSuppressedByCap: false };
  }

  const staffNotified = await notifyStaff(inquiry, config);
  const { queued, suppressed } = await queueEmails(inquiry, config);

  const alreadyAudited = await prisma.auditLog.findFirst({
    where: { action: "SERVICE_INQUIRY_NOTIFIED", entity: "ServiceInquiry", entityId: inquiry.id },
    select: { id: true },
  });
  if (!alreadyAudited) {
    await prisma.auditLog.create({
      data: {
        action: "SERVICE_INQUIRY_NOTIFIED",
        entity: "ServiceInquiry",
        entityId: inquiry.id,
        actorId: null,
        // Counts only: no addresses, no inquiry content.
        details: {
          inquiryNumber: inquiry.inquiryNumber,
          staffNotified,
          emailJobsQueued: queued,
          emailSuppressedByCap: suppressed,
          emailConfigured: config.emails.length > 0,
          invalidEmailEntries: config.invalidEmails,
        },
      },
    });
  }

  log("info", "service_inquiry_notified", {
    workerId,
    inquiryId: inquiry.id,
    inquiryNumber: inquiry.inquiryNumber,
    staffNotified,
    emailJobsQueued: queued,
    emailSuppressedByCap: suppressed,
  });
  return { handled: true, staffNotified, emailJobsQueued: queued, emailSuppressedByCap: suppressed };
}

type InquiryRef = { id: string; inquiryNumber: string; companyName: string; service: { name: string } };

/** In-app notification for every staff account that can read inquiries (capped, de-duplicated). */
async function notifyStaff(inquiry: InquiryRef, config: ServiceInquiryNotifierConfig): Promise<number> {
  const staff = await prisma.user.findMany({
    where: {
      userRoles: {
        some: {
          role: {
            OR: [{ name: "super_admin" }, { rolePermissions: { some: { permission: { name: NOTIFY_PERMISSION } } } }],
          },
        },
      },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: config.maxStaff,
  });
  if (staff.length === 0) return 0;

  const existing = await prisma.notification.findMany({
    where: {
      type: NotificationType.SERVICE_INQUIRY_CREATED,
      userId: { in: staff.map((s) => s.id) },
      metadata: { path: ["inquiryId"], equals: inquiry.id },
    },
    select: { userId: true },
  });
  const done = new Set(existing.map((n) => n.userId));
  const targets = staff.filter((s) => !done.has(s.id));
  if (targets.length === 0) return 0;

  const res = await prisma.notification.createMany({
    data: targets.map((s) => ({
      userId: s.id,
      type: NotificationType.SERVICE_INQUIRY_CREATED,
      title: `Yêu cầu dịch vụ mới ${inquiry.inquiryNumber}`,
      message: `${inquiry.companyName} gửi yêu cầu cho dịch vụ "${inquiry.service.name}".`,
      actionUrl: `/service-inquiries/${inquiry.id}`,
      isRead: false,
      metadata: { inquiryId: inquiry.id, inquiryNumber: inquiry.inquiryNumber },
    })),
  });
  return res.count;
}

/**
 * One email job per configured mailbox, through the existing automation queue (retry, lease and
 * delivery bookkeeping live there). Idempotency keys make re-runs no-ops; a global hourly cap
 * stops a flood of inquiries from becoming a flood of email (in-app notices still go out).
 */
async function queueEmails(
  inquiry: InquiryRef,
  config: ServiceInquiryNotifierConfig,
): Promise<{ queued: number; suppressed: boolean }> {
  if (config.emails.length === 0) return { queued: 0, suppressed: false };

  const recentJobs = await prisma.automationJob.count({
    where: {
      type: AutomationJobType.SERVICE_INQUIRY_NOTIFY_EMAIL,
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
  });
  let budget = config.hourlyEmailCap - recentJobs;
  let queued = 0;
  let suppressed = false;

  for (const email of config.emails) {
    const hash = emailHash(email);
    const idempotencyKey = `service-inquiry-notify:${inquiry.id}:${hash}`;
    const already = await prisma.automationJob.findUnique({ where: { idempotencyKey }, select: { id: true } });
    if (already) continue;
    if (budget <= 0) {
      suppressed = true;
      continue;
    }
    try {
      await prisma.$transaction(async (tx) => {
        const delivery = await tx.automationDelivery.create({
          data: {
            recipientEmail: email,
            template: "service_inquiry_created",
            idempotencyKey: `service-inquiry-notify-delivery:${inquiry.id}:${hash}`,
            status: AutomationDeliveryStatus.PENDING,
            payloadJson: { inquiryNumber: inquiry.inquiryNumber },
          },
        });
        const job = await tx.automationJob.create({
          data: {
            type: AutomationJobType.SERVICE_INQUIRY_NOTIFY_EMAIL,
            status: AutomationJobStatus.PENDING,
            idempotencyKey,
            sourceType: "ServiceInquiry",
            sourceId: inquiry.id,
            payloadJson: {
              deliveryId: delivery.id,
              recipientEmail: email,
              inquiryNumber: inquiry.inquiryNumber,
              serviceName: inquiry.service.name,
              companyName: inquiry.companyName,
              adminUrl: config.adminBaseUrl ? `${config.adminBaseUrl}/service-inquiries/${inquiry.id}` : null,
              providerIdempotencyKey: `email:service-inquiry:${inquiry.id}:${hash}`,
            },
          },
        });
        await tx.automationDelivery.update({ where: { id: delivery.id }, data: { jobId: job.id } });
      });
      queued++;
      budget--;
    } catch (err) {
      // A concurrent run created the same job/delivery first: that is the desired end state.
      if (!isUniqueViolation(err)) throw err;
    }
  }
  return { queued, suppressed };
}
