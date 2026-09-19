import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AutomationService } from "./automation.service";
import { AuditService } from "../audit/audit.service";
import {
  prisma,
  AutomationJobStatus,
  AutomationJobType,
  ContentStatus,
} from "@nexus/database";

describe("AutomationService", () => {
  let service: AutomationService;
  let auditService: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const mockAuditService = {
      logAction: jest.fn().mockResolvedValue(undefined),
      logActionWithClient: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutomationService,
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<AutomationService>(AutomationService);
    auditService = module.get(AuditService);

    // Default $transaction mock passes prisma through
    jest
      .spyOn(prisma, "$transaction")
      .mockImplementation(async (callback: any) => {
        if (typeof callback === "function") {
          return callback(prisma);
        }
        return callback;
      });

    // Default $executeRaw / $queryRaw mocks
    jest.spyOn(prisma, "$queryRaw").mockResolvedValue([]);
    jest.spyOn(prisma, "$executeRaw").mockResolvedValue(1);

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Job Lifecycle & Idempotency", () => {
    it("returns existing job when idempotency key matches (idempotency)", async () => {
      const existingJob = {
        id: "job-1",
        type: AutomationJobType.CMS_AI_DRAFT,
        status: AutomationJobStatus.PENDING,
        idempotencyKey: "test-key-1",
      };

      jest
        .spyOn(prisma.automationJob, "findUnique")
        .mockResolvedValue(existingJob as any);
      const createSpy = jest.spyOn(prisma.automationJob, "create");

      const result = await service.createJob({
        type: AutomationJobType.CMS_AI_DRAFT,
        idempotencyKey: "test-key-1",
        payloadJson: { topic: "AI in Retail" },
      });

      expect(result).toEqual(existingJob);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("transitions RUNNING job to SUCCEEDED on completeJob", async () => {
      const runningJob = {
        id: "job-2",
        type: AutomationJobType.ORDER_PAID_EMAIL,
        status: AutomationJobStatus.RUNNING,
      };

      jest
        .spyOn(prisma.automationJob, "findUnique")
        .mockResolvedValue(runningJob as any);
      const updateSpy = jest
        .spyOn(prisma.automationJob, "update")
        .mockResolvedValue({
          ...runningJob,
          status: AutomationJobStatus.SUCCEEDED,
        } as any);
      jest
        .spyOn(prisma.automationDelivery, "updateMany")
        .mockResolvedValue({ count: 1 } as any);

      const result = await service.completeJob("job-2", { done: true });
      expect(result!.status).toBe(AutomationJobStatus.SUCCEEDED);
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "job-2" },
          data: expect.objectContaining({
            status: AutomationJobStatus.SUCCEEDED,
          }),
        }),
      );
    });

    it("rejects generic completeJob for CMS_AI_DRAFT type", async () => {
      const aiJob = {
        id: "job-ai-complete",
        type: AutomationJobType.CMS_AI_DRAFT,
        status: AutomationJobStatus.RUNNING,
      };

      jest
        .spyOn(prisma.automationJob, "findUnique")
        .mockResolvedValue(aiJob as any);

      await expect(service.completeJob("job-ai-complete")).rejects.toThrow(
        /CMS_AI_DRAFT jobs cannot be completed via generic endpoint/,
      );
    });

    it("rejects completeJob from non-RUNNING state (CAS)", async () => {
      const pendingJob = {
        id: "job-3",
        type: AutomationJobType.ORDER_PAID_EMAIL,
        status: AutomationJobStatus.PENDING,
      };

      jest
        .spyOn(prisma.automationJob, "findUnique")
        .mockResolvedValue(pendingJob as any);

      await expect(service.completeJob("job-3")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("schedules retry when error is retryable and attempts < maxAttempts", async () => {
      const job = {
        id: "job-4",
        type: AutomationJobType.ORDER_PAID_EMAIL,
        status: AutomationJobStatus.RUNNING,
        attemptCount: 1,
        maxAttempts: 3,
      };

      jest
        .spyOn(prisma.automationJob, "findUnique")
        .mockResolvedValue(job as any);
      const updateSpy = jest
        .spyOn(prisma.automationJob, "update")
        .mockResolvedValue({
          ...job,
          status: AutomationJobStatus.PENDING,
        } as any);

      const res = await service.failJob("job-4", {
        errorCode: "RATE_LIMIT_429",
        errorMessage: "Too many requests",
        retryable: true,
      });

      expect(res.status).toBe(AutomationJobStatus.PENDING);
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "job-4" },
          data: expect.objectContaining({
            status: AutomationJobStatus.PENDING,
            scheduledAt: expect.any(Date),
          }),
        }),
      );
    });

    it("transitions to FAILED when maxAttempts reached and updates delivery", async () => {
      const job = {
        id: "job-5",
        type: AutomationJobType.ORDER_PAID_EMAIL,
        status: AutomationJobStatus.RUNNING,
        attemptCount: 3,
        maxAttempts: 3,
      };

      jest
        .spyOn(prisma.automationJob, "findUnique")
        .mockResolvedValue(job as any);
      const updateSpy = jest
        .spyOn(prisma.automationJob, "update")
        .mockResolvedValue({
          ...job,
          status: AutomationJobStatus.FAILED,
        } as any);
      const deliverySpy = jest
        .spyOn(prisma.automationDelivery, "updateMany")
        .mockResolvedValue({ count: 1 } as any);

      const res = await service.failJob("job-5", {
        errorCode: "TIMEOUT",
        errorMessage: "Gateway timed out",
        retryable: true,
      });

      expect(res.status).toBe(AutomationJobStatus.FAILED);
      expect(deliverySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { jobId: "job-5" },
          data: { status: "FAILED" },
        }),
      );
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "job-5" },
          data: expect.objectContaining({
            status: AutomationJobStatus.FAILED,
          }),
        }),
      );
    });

    it("allows manual retry for FAILED jobs and resets attemptCount", async () => {
      const failedJob = {
        id: "job-6",
        type: AutomationJobType.CMS_AI_DRAFT,
        status: AutomationJobStatus.FAILED,
        attemptCount: 3,
      };

      jest
        .spyOn(prisma.automationJob, "findUnique")
        .mockResolvedValue(failedJob as any);
      const updateSpy = jest
        .spyOn(prisma.automationJob, "update")
        .mockResolvedValue({
          ...failedJob,
          status: AutomationJobStatus.PENDING,
          attemptCount: 0,
        } as any);

      const res = await service.retryJob("job-6", "admin-1");
      expect(res.status).toBe(AutomationJobStatus.PENDING);
      expect(res.attemptCount).toBe(0);
      expect(auditService.logActionWithClient).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "AUTOMATION_JOB_RETRIED",
          entityId: "job-6",
        }),
      );
    });

    it("rejects manual retry for non-FAILED job", async () => {
      const runningJob = {
        id: "job-7",
        type: AutomationJobType.CMS_AI_DRAFT,
        status: AutomationJobStatus.RUNNING,
      };

      jest
        .spyOn(prisma.automationJob, "findUnique")
        .mockResolvedValue(runningJob as any);

      await expect(service.retryJob("job-7", "admin-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("cancels PENDING job and prevents execution", async () => {
      const pendingJob = {
        id: "job-8",
        type: AutomationJobType.ORDER_PAID_EMAIL,
        status: AutomationJobStatus.PENDING,
      };

      jest
        .spyOn(prisma.automationJob, "findUnique")
        .mockResolvedValue(pendingJob as any);
      const updateSpy = jest
        .spyOn(prisma.automationJob, "update")
        .mockResolvedValue({
          ...pendingJob,
          status: AutomationJobStatus.CANCELLED,
        } as any);

      const res = await service.cancelJob("job-8", "admin-1");
      expect(res.status).toBe(AutomationJobStatus.CANCELLED);
      expect(auditService.logActionWithClient).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "AUTOMATION_JOB_CANCELLED",
        }),
      );
    });
  });

  describe("AI Draft Orchestration & Content Authority", () => {
    it("enforces rate limit of max 3 active AI draft jobs per admin", async () => {
      jest.spyOn(prisma.automationJob, "count").mockResolvedValue(3);

      await expect(
        service.createAiDraftRequest("admin-1", {
          topic: "Next.js 15 Features",
          brief: "Overview of cache and server actions",
          language: "en",
        }),
      ).rejects.toThrow(/Rate limit exceeded/);
    });

    it("creates post in AI_DRAFT status only and sanitizes HTML", async () => {
      const job = {
        id: "job-ai-1",
        type: AutomationJobType.CMS_AI_DRAFT,
        status: AutomationJobStatus.RUNNING,
        createdBy: "admin-1",
      };

      jest.spyOn(prisma.automationJob, "findUnique").mockResolvedValue(job as any);
      jest.spyOn(prisma.contentPost, "findUnique").mockResolvedValue(null);
      jest.spyOn(prisma.contentPost, "create").mockImplementation(({ data }: any) => ({
        id: "post-ai-1",
        ...data,
      }));
      jest.spyOn(prisma.automationJob, "update").mockImplementation(({ data }: any) => ({
        ...job,
        ...data,
      }));

      const aiOutput = {
        title: "Building Modern Web Apps",
        excerpt: "A guide to building fast apps",
        content:
          "<p>Safe content</p><script>alert('xss')</script><iframe src='//evil.com'></iframe>",
        seoTitle: "Modern Web Apps Guide",
        seoDescription: "Learn how to build modern apps",
        suggestedSlug: "building-modern-apps",
      };

      const res = await service.applyAiDraftResult("job-ai-1", aiOutput);

      expect(res.post.status).toBe(ContentStatus.AI_DRAFT);
      expect(res.post.content).not.toContain("<script>");
      expect(res.post.content).not.toContain("<iframe>");
      expect(res.post.content).toContain("<p>Safe content</p>");
      expect(res.job!.status).toBe(AutomationJobStatus.SUCCEEDED);
    });

    it("rejects applyAiDraftResult when job is not in RUNNING status", async () => {
      const pendingAiJob = {
        id: "job-ai-pending",
        type: AutomationJobType.CMS_AI_DRAFT,
        status: AutomationJobStatus.PENDING,
        createdBy: "admin-1",
      };

      jest.spyOn(prisma.automationJob, "findUnique").mockResolvedValue(pendingAiJob as any);

      await expect(
        service.applyAiDraftResult("job-ai-pending", {
          title: "Title",
          excerpt: "Excerpt",
          content: "<p>Content</p>",
          seoTitle: "SEO",
          seoDescription: "Desc",
          suggestedSlug: "slug",
        }),
      ).rejects.toThrow(/job must be in RUNNING status/);
    });

    it("rejects oversized content (> 100KB)", async () => {
      const hugeContent = "A".repeat(105000); // 105KB

      await expect(
        service.applyAiDraftResult("job-ai-2", {
          title: "Huge Article",
          excerpt: "Excerpt",
          content: hugeContent,
          seoTitle: "SEO Title",
          seoDescription: "SEO Desc",
          suggestedSlug: "huge-article",
        }),
      ).rejects.toThrow(/Content exceeds maximum allowed size/);
    });
  });

  describe("Transactional Notifications", () => {
    it("creates ORDER_PAID_EMAIL job and delivery with server-resolved recipient", async () => {
      const order = {
        id: "order-123",
        currency: "USD",
        totalAmount: 4900,
        user: { email: "customer@example.com" },
      };

      jest.spyOn(prisma.order, "findUnique").mockResolvedValue(order as any);
      jest.spyOn(prisma.automationJob, "findUnique").mockResolvedValue(null);
      jest.spyOn(prisma.automationJob, "create").mockImplementation(({ data }: any) => ({
        id: "job-email-1",
        ...data,
      }));
      jest.spyOn(prisma.automationDelivery, "create").mockImplementation(({ data }: any) => ({
        id: "delivery-1",
        ...data,
      }));
      jest.spyOn(prisma.automationJob, "update").mockImplementation(({ data }: any) => ({
        id: "job-email-1",
        type: AutomationJobType.ORDER_PAID_EMAIL,
        ...data,
      }));

      const job = await service.processOrderPaidNotification("order-123");

      expect(job.type).toBe(AutomationJobType.ORDER_PAID_EMAIL);
      expect((job.payloadJson as any)?.recipientEmail).toBe("customer@example.com");
      expect(prisma.automationDelivery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            recipientEmail: "customer@example.com",
            template: "order_receipt",
          }),
        }),
      );
    });

    it("masks internal license key and never puts plaintext in notification payload", async () => {
      const license = {
        id: "lic-456",
        keyLast4: "1234",
        entitlement: {
          user: { email: "licensee@example.com" },
        },
      };

      jest.spyOn(prisma.internalLicense, "findUnique").mockResolvedValue(license as any);
      jest.spyOn(prisma.automationJob, "findUnique").mockResolvedValue(null);
      jest.spyOn(prisma.automationJob, "create").mockImplementation(({ data }: any) => ({
        id: "job-lic-email-1",
        ...data,
      }));
      jest.spyOn(prisma.automationDelivery, "create").mockImplementation(({ data }: any) => ({
        id: "delivery-lic-1",
        ...data,
      }));
      jest.spyOn(prisma.automationJob, "update").mockImplementation(({ data }: any) => ({
        id: "job-lic-email-1",
        type: AutomationJobType.LICENSE_PROVISIONED_EMAIL,
        ...data,
      }));

      const job = await service.processLicenseProvisionedNotification("lic-456");

      expect(job.type).toBe(AutomationJobType.LICENSE_PROVISIONED_EMAIL);
      expect((job.payloadJson as any)?.maskedKey).toBe("NXS-****-****-1234");
      expect((job.payloadJson as any)?.plaintextKey).toBeUndefined();
    });
  });
});
