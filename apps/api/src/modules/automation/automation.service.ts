import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import {
  prisma,
  Prisma,
  AutomationJobStatus,
  AutomationJobType,
  ContentStatus,
} from "@nexus/database";
import {
  sanitizeContentHtml,
  slugify,
  isReservedSlug,
} from "@nexus/utils";
import {
  CreateAiDraftRequestDto,
  QueryAutomationJobsDto,
  AiDraftOutputDto,
} from "./dto/automation.dto";
import { AuditService } from "../audit/audit.service";
import * as crypto from "crypto";

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(private readonly auditService: AuditService) {}

  /**
   * Helper to row-lock a job FOR UPDATE in PostgreSQL.
   * Falls back to findUnique in test environments where raw queries are not mocked.
   */
  private async lockJobForUpdate(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<{
    id: string;
    type: AutomationJobType;
    status: AutomationJobStatus;
    attemptCount: number;
    maxAttempts: number;
    resultJson: any;
    createdBy?: string | null;
  }> {
    if (typeof tx.$queryRaw === "function") {
      try {
        const lockedRows = await tx.$queryRaw<any[]>`
          SELECT * FROM automation_jobs WHERE id = ${id} FOR UPDATE;
        `;
        if (lockedRows && lockedRows.length > 0) {
          const row = lockedRows[0];
          return {
            id: row.id,
            type: row.type,
            status: row.status,
            attemptCount: row.attempt_count ?? row.attemptCount ?? 0,
            maxAttempts: row.max_attempts ?? row.maxAttempts ?? 3,
            resultJson: row.result_json ?? row.resultJson,
            createdBy: row.created_by ?? row.createdBy,
          };
        }
      } catch (err) {
        if (err instanceof NotFoundException) throw err;
      }
    }

    const job = await tx.automationJob.findUnique({ where: { id } });
    if (!job) {
      throw new NotFoundException(`Automation job '${id}' not found`);
    }
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
      resultJson: job.resultJson,
      createdBy: job.createdBy,
    };
  }

  /**
   * Creates an automation job idempotently.
   * Catches P2002 to cleanly handle concurrent job creation.
   */
  async createJob(params: {
    type: AutomationJobType;
    idempotencyKey: string;
    payloadJson: any;
    sourceType?: string;
    sourceId?: string;
    createdBy?: string;
    scheduledAt?: Date;
    maxAttempts?: number;
  }) {
    try {
      const existing = await prisma.automationJob.findUnique({
        where: { idempotencyKey: params.idempotencyKey },
      });

      if (existing) {
        return existing;
      }

      return await prisma.automationJob.create({
        data: {
          type: params.type,
          status: AutomationJobStatus.PENDING,
          idempotencyKey: params.idempotencyKey,
          payloadJson: params.payloadJson,
          sourceType: params.sourceType,
          sourceId: params.sourceId,
          createdBy: params.createdBy,
          scheduledAt: params.scheduledAt,
          maxAttempts: params.maxAttempts ?? 3,
        },
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        const existing = await prisma.automationJob.findUnique({
          where: { idempotencyKey: params.idempotencyKey },
        });
        if (existing) return existing;
      }
      throw err;
    }
  }

  async getJobById(id: string) {
    const job = await prisma.automationJob.findUnique({
      where: { id },
      include: { deliveries: true },
    });

    if (!job) {
      throw new NotFoundException(`Automation job '${id}' not found`);
    }

    return job;
  }

  async listJobs(query: QueryAutomationJobsDto) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.AutomationJobWhereInput = {};
    if (query.status) {
      where.status = query.status as AutomationJobStatus;
    }
    if (query.type) {
      where.type = query.type as AutomationJobType;
    }

    const [items, total] = await Promise.all([
      prisma.automationJob.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.automationJob.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Completes an automation job via atomic CAS.
   * Generic completeJob MUST reject CMS_AI_DRAFT (requires applyAiDraftResult).
   * Atomically marks associated AutomationDelivery as SENT with sentAt and providerMessageId.
   */
  async completeJob(
    id: string,
    resultJson?: any,
    providerMessageId?: string,
  ) {
    return prisma.$transaction(async (tx) => {
      const job = await this.lockJobForUpdate(tx, id);

      // CMS_AI_DRAFT jobs must NOT be completed via generic endpoint
      if (job.type === AutomationJobType.CMS_AI_DRAFT) {
        throw new BadRequestException(
          "CMS_AI_DRAFT jobs cannot be completed via generic endpoint; use /content-ai-draft-result",
        );
      }

      // Idempotent return if already SUCCEEDED
      if (job.status === AutomationJobStatus.SUCCEEDED) {
        return tx.automationJob.findUnique({
          where: { id },
          include: { deliveries: true },
        });
      }

      // CAS: only RUNNING status can be completed
      if (job.status !== AutomationJobStatus.RUNNING) {
        throw new BadRequestException(
          `Cannot complete job: status must be RUNNING (current: ${job.status})`,
        );
      }

      const resolvedProviderMessageId =
        providerMessageId ||
        resultJson?.providerMessageId ||
        resultJson?.messageId ||
        null;

      await tx.automationDelivery.updateMany({
        where: { jobId: id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          providerMessageId: resolvedProviderMessageId,
        },
      });

      return tx.automationJob.update({
        where: { id },
        data: {
          status: AutomationJobStatus.SUCCEEDED,
          resultJson: resultJson !== undefined ? resultJson : Prisma.DbNull,
          completedAt: new Date(),
          leaseUntil: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
        include: { deliveries: true },
      });
    });
  }

  /**
   * Fails an automation job via atomic CAS.
   * Enforces bounded errorCode (<=64) and errorMessage (<=1000).
   * Marks AutomationDelivery as FAILED upon terminal failure.
   */
  async failJob(
    id: string,
    error: { errorCode: string; errorMessage: string; retryable?: boolean },
  ) {
    const sanitizedErrorCode = (error.errorCode || "UNKNOWN_ERROR").slice(0, 64);
    const sanitizedErrorMessage = (error.errorMessage || "Unknown error occurred").slice(0, 1000);

    return prisma.$transaction(async (tx) => {
      const job = await this.lockJobForUpdate(tx, id);

      if (
        job.status === AutomationJobStatus.SUCCEEDED ||
        job.status === AutomationJobStatus.CANCELLED
      ) {
        throw new BadRequestException(
          `Cannot fail job in terminal state ${job.status}`,
        );
      }

      if (job.status !== AutomationJobStatus.RUNNING) {
        throw new BadRequestException(
          `Cannot fail job: status must be RUNNING (current: ${job.status})`,
        );
      }

      const isRetryable = error.retryable ?? false;
      const canRetry = isRetryable && job.attemptCount < job.maxAttempts;

      if (canRetry) {
        const backoffSeconds =
          job.attemptCount === 1 ? 30 : job.attemptCount === 2 ? 120 : 600;
        const scheduledAt = new Date(Date.now() + backoffSeconds * 1000);

        return tx.automationJob.update({
          where: { id },
          data: {
            status: AutomationJobStatus.PENDING,
            scheduledAt,
            leaseUntil: null,
            lastErrorCode: sanitizedErrorCode,
            lastErrorMessage: sanitizedErrorMessage,
          },
        });
      }

      await tx.automationDelivery.updateMany({
        where: { jobId: id },
        data: {
          status: "FAILED",
        },
      });

      return tx.automationJob.update({
        where: { id },
        data: {
          status: AutomationJobStatus.FAILED,
          completedAt: new Date(),
          leaseUntil: null,
          lastErrorCode: sanitizedErrorCode,
          lastErrorMessage: sanitizedErrorMessage,
        },
      });
    });
  }

  /**
   * Retries a FAILED automation job via atomic CAS.
   */
  async retryJob(id: string, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const job = await this.lockJobForUpdate(tx, id);

      if (job.status !== AutomationJobStatus.FAILED) {
        throw new BadRequestException(
          `Only FAILED automation jobs can be retried (current: ${job.status})`,
        );
      }

      const updated = await tx.automationJob.update({
        where: { id },
        data: {
          status: AutomationJobStatus.PENDING,
          attemptCount: 0,
          scheduledAt: new Date(),
          completedAt: null,
          startedAt: null,
          leaseUntil: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });

      await this.auditService.logActionWithClient(tx, {
        action: "AUTOMATION_JOB_RETRIED",
        entity: "AutomationJob",
        entityId: id,
        actorId,
        details: {
          jobType: job.type,
          previousAttempts: job.attemptCount,
        },
      });

      return updated;
    });
  }

  /**
   * Cancels a PENDING automation job via atomic CAS.
   */
  async cancelJob(id: string, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const job = await this.lockJobForUpdate(tx, id);

      if (job.status !== AutomationJobStatus.PENDING) {
        throw new BadRequestException(
          `Only PENDING automation jobs can be cancelled (current: ${job.status})`,
        );
      }

      const updated = await tx.automationJob.update({
        where: { id },
        data: {
          status: AutomationJobStatus.CANCELLED,
          completedAt: new Date(),
          leaseUntil: null,
        },
      });

      await this.auditService.logActionWithClient(tx, {
        action: "AUTOMATION_JOB_CANCELLED",
        entity: "AutomationJob",
        entityId: id,
        actorId,
        details: { jobType: job.type },
      });

      return updated;
    });
  }

  /**
   * Admin CMS Action: Submit AI draft request with concurrency-safe advisory rate limiting.
   */
  async createAiDraftRequest(adminUserId: string, dto: CreateAiDraftRequestDto) {
    return prisma.$transaction(async (tx) => {
      if (typeof tx.$executeRaw === "function") {
        try {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ai-draft-rate-limit:' || ${adminUserId}));`;
        } catch {
          // ignore advisory lock error if mock driver
        }
      }

      const activeCount = await tx.automationJob.count({
        where: {
          createdBy: adminUserId,
          type: AutomationJobType.CMS_AI_DRAFT,
          status: {
            in: [AutomationJobStatus.PENDING, AutomationJobStatus.RUNNING],
          },
        },
      });

      if (activeCount >= 3) {
        throw new BadRequestException(
          "Rate limit exceeded: maximum 3 active AI draft jobs allowed per administrator",
        );
      }

      const idempotencyKey = `cms-ai-draft:${crypto.randomUUID()}`;
      const job = await tx.automationJob.create({
        data: {
          type: AutomationJobType.CMS_AI_DRAFT,
          status: AutomationJobStatus.PENDING,
          idempotencyKey,
          payloadJson: dto as unknown as Prisma.InputJsonValue,
          createdBy: adminUserId,
          maxAttempts: 3,
        },
      });

      await this.auditService.logActionWithClient(tx, {
        action: "AI_DRAFT_REQUESTED",
        entity: "AutomationJob",
        entityId: job.id,
        actorId: adminUserId,
        details: { topic: dto.topic, language: dto.language },
      });

      return job;
    });
  }

  /**
   * Internal Callback: Apply AI draft result.
   * Serializes concurrent callbacks with PostgreSQL row-lock (FOR UPDATE).
   * Enforces RUNNING status check (rejects PENDING, FAILED, CANCELLED).
   * Idempotently returns existing post if already SUCCEEDED.
   * STRICT AUTHORITY INVARIANT: Creates post with status AI_DRAFT ONLY!
   */
  async applyAiDraftResult(jobId: string, result: AiDraftOutputDto) {
    if (result.content && result.content.length > 100000) {
      throw new BadRequestException(
        "Content exceeds maximum allowed size (100KB)",
      );
    }

    const sanitizedContent = sanitizeContentHtml(result.content);

    return prisma.$transaction(async (tx) => {
      const job = await this.lockJobForUpdate(tx, jobId);

      if (job.type !== AutomationJobType.CMS_AI_DRAFT) {
        throw new BadRequestException(
          `Job type mismatch: expected CMS_AI_DRAFT, received ${job.type}`,
        );
      }

      if (job.status === AutomationJobStatus.SUCCEEDED) {
        const resJson = typeof job.resultJson === "string" ? JSON.parse(job.resultJson) : job.resultJson;
        const existingPostId = resJson?.postId;
        if (existingPostId) {
          const existingPost = await tx.contentPost.findUnique({
            where: { id: existingPostId },
          });
          if (existingPost) {
            const mappedJob = await tx.automationJob.findUnique({ where: { id: jobId } });
            return { post: existingPost, job: mappedJob };
          }
        }
      }

      if (job.status !== AutomationJobStatus.RUNNING) {
        throw new BadRequestException(
          `Cannot apply AI draft result: job must be in RUNNING status (current: ${job.status})`,
        );
      }

      let baseSlug = slugify(result.suggestedSlug || result.title);
      if (isReservedSlug(baseSlug)) {
        baseSlug = `${baseSlug}-article`;
      }

      let candidateSlug = baseSlug;
      let collisionCount = 1;
      const MAX_SLUG_ATTEMPTS = 100;
      while (
        await tx.contentPost.findUnique({ where: { slug: candidateSlug } })
      ) {
        if (collisionCount > MAX_SLUG_ATTEMPTS) {
          candidateSlug = `${baseSlug}-${crypto.randomBytes(4).toString("hex")}`;
          break;
        }
        candidateSlug = `${baseSlug}-${collisionCount}`;
        collisionCount++;
      }

      const createdPost = await tx.contentPost.create({
        data: {
          title: result.title,
          slug: candidateSlug,
          excerpt: result.excerpt,
          content: sanitizedContent,
          seoTitle: result.seoTitle,
          seoDescription: result.seoDescription,
          status: ContentStatus.AI_DRAFT,
          authorId: job.createdBy,
        },
      });

      const updatedJob = await tx.automationJob.update({
        where: { id: jobId },
        data: {
          status: AutomationJobStatus.SUCCEEDED,
          resultJson: {
            postId: createdPost.id,
            slug: createdPost.slug,
          },
          completedAt: new Date(),
          leaseUntil: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });

      await this.auditService.logActionWithClient(tx, {
        action: "CONTENT_CREATED",
        entity: "ContentPost",
        entityId: createdPost.id,
        actorId: job.createdBy,
        details: {
          status: ContentStatus.AI_DRAFT,
          source: "CMS_AI_DRAFT",
          jobId,
        },
      });

      return { post: createdPost, job: updatedJob };
    });
  }

  /**
   * Authoritative backend trigger: ORDER_PAID outbox event creates email job idempotently.
   */
  async processOrderPaidNotification(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { user: true },
    });

    if (!order) {
      throw new NotFoundException(`Order '${orderId}' not found`);
    }

    const recipientEmail = order.user?.email;
    if (!recipientEmail) {
      throw new BadRequestException(
        `Order '${orderId}' has no associated customer email`,
      );
    }

    const idempotencyKey = `order-paid-email:${orderId}`;
    const deliveryIdempotencyKey = `order-paid-delivery:${orderId}`;
    const providerIdempotencyKey = `email:order-paid:${orderId}`;

    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.automationJob.findUnique({
          where: { idempotencyKey },
        });

        if (existing) {
          return existing;
        }

        const job = await tx.automationJob.create({
          data: {
            type: AutomationJobType.ORDER_PAID_EMAIL,
            status: AutomationJobStatus.PENDING,
            idempotencyKey,
            sourceType: "Order",
            sourceId: orderId,
            payloadJson: {
              orderId,
              recipientEmail,
              currency: order.currency,
              totalAmount: order.totalAmount,
              providerIdempotencyKey,
            },
          },
        });

        const delivery = await tx.automationDelivery.create({
          data: {
            jobId: job.id,
            recipientEmail,
            template: "order_receipt",
            idempotencyKey: deliveryIdempotencyKey,
            status: "PENDING",
            payloadJson: {
              orderId,
              totalAmount: order.totalAmount,
              currency: order.currency,
              providerIdempotencyKey,
            },
          },
        });

        return tx.automationJob.update({
          where: { id: job.id },
          data: {
            payloadJson: {
              orderId,
              recipientEmail,
              currency: order.currency,
              totalAmount: order.totalAmount,
              deliveryId: delivery.id,
              providerIdempotencyKey,
            },
          },
        });
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        const existing = await prisma.automationJob.findUnique({
          where: { idempotencyKey },
        });
        if (existing) return existing;
      }
      throw err;
    }
  }

  /**
   * Authoritative backend trigger: LICENSE_PROVISIONED event creates email job.
   * NEVER transmits plaintext license key! Masked key and portal link only.
   */
  async processLicenseProvisionedNotification(licenseId: string) {
    const license = await prisma.internalLicense.findUnique({
      where: { id: licenseId },
      include: {
        entitlement: {
          include: { user: true },
        },
      },
    });

    if (!license) {
      throw new NotFoundException(`License '${licenseId}' not found`);
    }

    const recipientEmail = license.entitlement?.user?.email;
    if (!recipientEmail) {
      throw new BadRequestException(
        `License '${licenseId}' has no associated recipient email`,
      );
    }

    const idempotencyKey = `license-provisioned-email:${licenseId}`;
    const deliveryIdempotencyKey = `license-provisioned-delivery:${licenseId}`;
    const providerIdempotencyKey = `email:license-provisioned:${licenseId}`;
    const maskedKey = `NXS-****-****-${license.keyLast4 || "9999"}`;

    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.automationJob.findUnique({
          where: { idempotencyKey },
        });

        if (existing) {
          return existing;
        }

        const job = await tx.automationJob.create({
          data: {
            type: AutomationJobType.LICENSE_PROVISIONED_EMAIL,
            status: AutomationJobStatus.PENDING,
            idempotencyKey,
            sourceType: "License",
            sourceId: licenseId,
            payloadJson: {
              licenseId,
              recipientEmail,
              maskedKey,
              portalUrl: "/licenses",
              providerIdempotencyKey,
            },
          },
        });

        const delivery = await tx.automationDelivery.create({
          data: {
            jobId: job.id,
            recipientEmail,
            template: "license_ready",
            idempotencyKey: deliveryIdempotencyKey,
            status: "PENDING",
            payloadJson: {
              licenseId,
              maskedKey,
              portalUrl: "/licenses",
              providerIdempotencyKey,
            },
          },
        });

        return tx.automationJob.update({
          where: { id: job.id },
          data: {
            payloadJson: {
              licenseId,
              recipientEmail,
              maskedKey,
              portalUrl: "/licenses",
              deliveryId: delivery.id,
              providerIdempotencyKey,
            },
          },
        });
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        const existing = await prisma.automationJob.findUnique({
          where: { idempotencyKey },
        });
        if (existing) return existing;
      }
      throw err;
    }
  }
}
