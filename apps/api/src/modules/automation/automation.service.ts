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
  isValidAutomationJobTransition,
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
   * Creates an automation job idempotently.
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
    const existing = await prisma.automationJob.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });

    if (existing) {
      return existing;
    }

    return prisma.automationJob.create({
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

  async completeJob(id: string, resultJson?: any) {
    const job = await this.getJobById(id);

    if (job.status === AutomationJobStatus.SUCCEEDED) {
      return job;
    }

    if (
      !isValidAutomationJobTransition(
        job.status,
        AutomationJobStatus.SUCCEEDED,
      )
    ) {
      throw new BadRequestException(
        `Invalid status transition from ${job.status} to SUCCEEDED`,
      );
    }

    return prisma.automationJob.update({
      where: { id },
      data: {
        status: AutomationJobStatus.SUCCEEDED,
        resultJson: resultJson !== undefined ? resultJson : Prisma.DbNull,
        completedAt: new Date(),
        leaseUntil: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
  }

  async failJob(
    id: string,
    error: { errorCode: string; errorMessage: string; retryable?: boolean },
  ) {
    const job = await this.getJobById(id);

    if (
      job.status === AutomationJobStatus.SUCCEEDED ||
      job.status === AutomationJobStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Cannot fail job in terminal state ${job.status}`,
      );
    }

    // Bounded retry backoff:
    // If retryable and attemptCount < maxAttempts, transition back to PENDING with backoff delay
    const isRetryable = error.retryable ?? false;
    const canRetry = isRetryable && job.attemptCount < job.maxAttempts;

    if (canRetry) {
      // Exponential backoff: 30s, 2m, 10m
      const backoffSeconds =
        job.attemptCount === 1 ? 30 : job.attemptCount === 2 ? 120 : 600;
      const scheduledAt = new Date(Date.now() + backoffSeconds * 1000);

      return prisma.automationJob.update({
        where: { id },
        data: {
          status: AutomationJobStatus.PENDING,
          scheduledAt,
          leaseUntil: null,
          lastErrorCode: error.errorCode,
          lastErrorMessage: error.errorMessage,
        },
      });
    }

    // Otherwise mark as FAILED (terminal unless manual admin retry)
    return prisma.automationJob.update({
      where: { id },
      data: {
        status: AutomationJobStatus.FAILED,
        completedAt: new Date(),
        leaseUntil: null,
        lastErrorCode: error.errorCode,
        lastErrorMessage: error.errorMessage,
      },
    });
  }

  async retryJob(id: string, actorId: string) {
    const job = await this.getJobById(id);

    if (job.status !== AutomationJobStatus.FAILED) {
      throw new BadRequestException(
        `Only FAILED automation jobs can be retried (current: ${job.status})`,
      );
    }

    const updated = await prisma.automationJob.update({
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

    await this.auditService.logAction({
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
  }

  async cancelJob(id: string, actorId: string) {
    const job = await this.getJobById(id);

    if (job.status !== AutomationJobStatus.PENDING) {
      throw new BadRequestException(
        `Only PENDING automation jobs can be cancelled (current: ${job.status})`,
      );
    }

    const updated = await prisma.automationJob.update({
      where: { id },
      data: {
        status: AutomationJobStatus.CANCELLED,
        completedAt: new Date(),
        leaseUntil: null,
      },
    });

    await this.auditService.logAction({
      action: "AUTOMATION_JOB_CANCELLED",
      entity: "AutomationJob",
      entityId: id,
      actorId,
      details: { jobType: job.type },
    });

    return updated;
  }

  /**
   * Admin CMS Action: Submit AI draft request with rate limiting and audit trail.
   */
  async createAiDraftRequest(adminUserId: string, dto: CreateAiDraftRequestDto) {
    // Rate limit check: max 3 active AI draft jobs per admin user
    const activeCount = await prisma.automationJob.count({
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
    const job = await this.createJob({
      type: AutomationJobType.CMS_AI_DRAFT,
      idempotencyKey,
      payloadJson: dto,
      createdBy: adminUserId,
    });

    await this.auditService.logAction({
      action: "AI_DRAFT_REQUESTED",
      entity: "AutomationJob",
      entityId: job.id,
      actorId: adminUserId,
      details: { topic: dto.topic, language: dto.language },
    });

    return job;
  }

  /**
   * Internal Callback: Apply AI draft result.
   * STRICT AUTHORITY INVARIANT: Creates post with status AI_DRAFT ONLY!
   */
  async applyAiDraftResult(jobId: string, result: AiDraftOutputDto) {
    const job = await this.getJobById(jobId);

    if (job.type !== AutomationJobType.CMS_AI_DRAFT) {
      throw new BadRequestException(
        `Job type mismatch: expected CMS_AI_DRAFT, received ${job.type}`,
      );
    }

    if (job.status === AutomationJobStatus.SUCCEEDED) {
      // Idempotency: return existing result without creating duplicate post
      const existingPostId = (job.resultJson as any)?.postId;
      if (existingPostId) {
        const existingPost = await prisma.contentPost.findUnique({
          where: { id: existingPostId },
        });
        if (existingPost) {
          return { post: existingPost, job };
        }
      }
    }

    // Validate size: content must not exceed 100KB
    if (result.content && result.content.length > 100000) {
      throw new BadRequestException(
        "Content exceeds maximum allowed size (100KB)",
      );
    }

    // Sanitize HTML using Phase 11 parser-based allowlist (sanitize-html)
    const sanitizedContent = sanitizeContentHtml(result.content);

    // Generate normalized unique slug with collision and reserved slug resolution
    let baseSlug = slugify(result.suggestedSlug || result.title);
    if (isReservedSlug(baseSlug)) {
      baseSlug = `${baseSlug}-article`;
    }

    let candidateSlug = baseSlug;
    let collisionCount = 1;
    while (
      await prisma.contentPost.findUnique({ where: { slug: candidateSlug } })
    ) {
      candidateSlug = `${baseSlug}-${collisionCount}`;
      collisionCount++;
    }

    // Atomic transaction: create ContentPost in AI_DRAFT status, update AutomationJob, record audit
    const { post, updatedJob } = await prisma.$transaction(async (tx) => {
      const createdPost = await tx.contentPost.create({
        data: {
          title: result.title,
          slug: candidateSlug,
          excerpt: result.excerpt,
          content: sanitizedContent,
          seoTitle: result.seoTitle,
          seoDescription: result.seoDescription,
          status: ContentStatus.AI_DRAFT, // AUTHORITY: AI_DRAFT ONLY!
          authorId: job.createdBy,
        },
      });

      const updated = await tx.automationJob.update({
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

      return { post: createdPost, updatedJob: updated };
    });

    return { post, job: updatedJob };
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
    const existing = await prisma.automationJob.findUnique({
      where: { idempotencyKey },
    });

    if (existing) {
      return existing;
    }

    return prisma.$transaction(async (tx) => {
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
          },
        },
      });

      await tx.automationDelivery.create({
        data: {
          jobId: job.id,
          recipientEmail,
          template: "order_receipt",
          idempotencyKey: `order-paid-delivery:${orderId}`,
          status: "PENDING",
          payloadJson: {
            orderId,
            totalAmount: order.totalAmount,
            currency: order.currency,
          },
        },
      });

      return job;
    });
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
    const existing = await prisma.automationJob.findUnique({
      where: { idempotencyKey },
    });

    if (existing) {
      return existing;
    }

    const maskedKey = `NXS-****-****-${license.keyLast4 || "9999"}`;

    return prisma.$transaction(async (tx) => {
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
          },
        },
      });

      await tx.automationDelivery.create({
        data: {
          jobId: job.id,
          recipientEmail,
          template: "license_ready",
          idempotencyKey: `license-provisioned-delivery:${licenseId}`,
          status: "PENDING",
          payloadJson: {
            licenseId,
            maskedKey,
            portalUrl: "/licenses",
          },
        },
      });

      return job;
    });
  }
}
