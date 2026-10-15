import * as crypto from "crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  prisma,
  Prisma,
  ServiceInquiryStatus,
  ServiceProjectEventType,
  ServiceStatus,
  canConvertInquiry,
  canCustomerAccessInquiry,
  isManualInquiryTransition,
} from "@nexus/database";
import { generateTicketNumber, isFeatureEnabled, sanitizeTicketContent } from "@nexus/utils";
import {
  AdminServiceInquiryDto,
  AdminServiceProjectDto,
  CreateServiceInquiryResponse,
  PaginatedList,
  SERVICE_INQUIRY_MAX_FILES,
  ServiceFileDownloadResponse,
  ServiceInquiryDto,
} from "@nexus/contracts";
import { AuditService } from "../audit/audit.service";
import {
  AdminUpdateInquiryDto,
  ConvertInquiryDto,
  CreateServiceInquiryDto,
  QueryServiceListDto,
} from "./dto/services.dto";
import { InquiryRateLimiter } from "./inquiry-rate-limiter";
import { UploadedServiceFile, hashClientIp, validateServiceFile } from "./service-files";
import { ServiceFileStore } from "./service-file-store";
import { ActorContext } from "./service-catalog.service";
import { withUniqueCodeRetry } from "./unique-code";
import { toAdminInquiryDto, toInquiryDto } from "./services.mappers";
import { loadAdminProject } from "./service-projects.service";

const INQUIRY_INCLUDE = {
  service: { select: { id: true, slug: true, name: true } },
  attachments: { orderBy: { createdAt: "asc" } },
  project: { select: { id: true } },
} as const;

export interface SubmissionContext {
  userId?: string | null;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class ServiceInquiriesService {
  private readonly logger = new Logger(ServiceInquiriesService.name);
  private readonly ipSalt: string;

  constructor(
    private readonly audit: AuditService,
    private readonly rateLimiter: InquiryRateLimiter,
    private readonly files: ServiceFileStore,
    config: ConfigService,
  ) {
    const salt = config.get<string>("SERVICE_INQUIRY_IP_SALT")?.trim();
    // Fail closed when the module is live in production: a known salt makes stored IP hashes
    // reversible. While FEATURE_SERVICES is off the API must still boot for the marketplace.
    if (!salt && config.get<string>("NODE_ENV") === "production" && isFeatureEnabled("services")) {
      throw new Error("[Services] SERVICE_INQUIRY_IP_SALT is required in production when FEATURE_SERVICES is enabled");
    }
    this.ipSalt = salt || "local-dev-only-salt";
  }

  // ---------------------------------------------------------- submission

  async submit(
    dto: CreateServiceInquiryDto,
    files: UploadedServiceFile[],
    ctx: SubmissionContext,
  ): Promise<CreateServiceInquiryResponse> {
    // Honeypot filled in: answer like a success so bots get no signal, store nothing.
    if (dto.website && dto.website.trim() !== "") {
      this.logger.warn("Service inquiry honeypot triggered; submission discarded");
      return { inquiryNumber: generateTicketNumber("SI"), status: ServiceInquiryStatus.NEW };
    }

    const email = dto.contactEmail.toLowerCase();

    // Idempotent retry: same key returns the original inquiry without consuming quota.
    if (dto.submissionKey) {
      const existing = await this.findBySubmissionKey(dto.submissionKey, email);
      if (existing) return existing;
    }

    files = files || [];
    if (files.length > 0 && !ctx.userId) {
      throw new BadRequestException("Vui lòng đăng nhập để đính kèm tài liệu.");
    }
    if (files.length > SERVICE_INQUIRY_MAX_FILES) {
      throw new BadRequestException(`Tối đa ${SERVICE_INQUIRY_MAX_FILES} tệp đính kèm.`);
    }
    const validated = files.map(validateServiceFile);

    const requirements = sanitizeTicketContent(dto.requirements);
    if (!requirements) {
      throw new BadRequestException("Nội dung yêu cầu không được để trống.");
    }

    const service = await prisma.service.findFirst({
      where: { slug: dto.serviceSlug, status: ServiceStatus.ACTIVE },
      select: { id: true },
    });
    if (!service) {
      throw new NotFoundException("Dịch vụ không tồn tại hoặc đã ngừng nhận yêu cầu.");
    }

    const ipHash = hashClientIp(ctx.ipAddress, this.ipSalt);
    await this.rateLimiter.consumeForSubmission(ipHash, email);

    const inquiryId = crypto.randomUUID();
    const uploaded = await this.files.uploadAll("inquiries", inquiryId, validated);

    try {
      const created = await withUniqueCodeRetry("inquiry_number", "inquiryNumber", () => prisma.$transaction(async (tx) => {
        const row = await tx.serviceInquiry.create({
          data: {
            id: inquiryId,
            inquiryNumber: generateTicketNumber("SI"),
            serviceId: service.id,
            userId: ctx.userId ?? null,
            companyName: sanitizeTicketContent(dto.companyName),
            contactName: sanitizeTicketContent(dto.contactName),
            contactEmail: email,
            contactPhone: dto.contactPhone || null,
            requirements,
            desiredFeatures: (dto.desiredFeatures ?? []).map((f) => sanitizeTicketContent(f)).filter(Boolean),
            budgetRange: dto.budgetRange ?? null,
            timeline: dto.timeline ?? null,
            status: ServiceInquiryStatus.NEW,
            submissionKey: dto.submissionKey ?? null,
            ipHash,
            attachments: uploaded.length
              ? {
                  create: uploaded.map((f) => ({
                    fileName: f.fileName,
                    storageKey: f.storageKey,
                    mimeType: f.mimeType,
                    sizeBytes: f.sizeBytes,
                    sha256: f.sha256,
                    uploadedById: ctx.userId ?? null,
                  })),
                }
              : undefined,
          },
        });
        await this.audit.logActionWithClient(tx, {
          action: "SERVICE_INQUIRY_SUBMITTED",
          entity: "ServiceInquiry",
          entityId: row.id,
          actorId: ctx.userId ?? null,
          details: { inquiryNumber: row.inquiryNumber, serviceId: service.id, attachments: uploaded.length },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });
        return row;
      }));
      return { inquiryNumber: created.inquiryNumber, status: created.status };
    } catch (err) {
      await this.files.deleteObjects(uploaded.map((f) => f.storageKey));
      // Two concurrent submissions with the same key: the loser returns the winner's inquiry.
      if (dto.submissionKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const existing = await this.findBySubmissionKey(dto.submissionKey, email);
        if (existing) return existing;
      }
      throw err;
    }
  }

  private async findBySubmissionKey(
    submissionKey: string,
    email: string,
  ): Promise<CreateServiceInquiryResponse | null> {
    const existing = await prisma.serviceInquiry.findUnique({ where: { submissionKey } });
    if (!existing) return null;
    if (existing.contactEmail !== email) {
      throw new ConflictException("submissionKey has already been used");
    }
    return { inquiryNumber: existing.inquiryNumber, status: existing.status };
  }

  // ------------------------------------------------------------ customer

  async listMine(userId: string, query: QueryServiceListDto): Promise<PaginatedList<ServiceInquiryDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.ServiceInquiryWhereInput = { userId };
    const [total, rows] = await Promise.all([
      prisma.serviceInquiry.count({ where }),
      prisma.serviceInquiry.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: INQUIRY_INCLUDE,
      }),
    ]);
    return { items: rows.map(toInquiryDto), total, page, limit };
  }

  async getMine(userId: string, idOrNumber: string): Promise<ServiceInquiryDto> {
    const row = await this.findByIdOrNumber(idOrNumber);
    // Anti-enumeration: someone else's inquiry is indistinguishable from a missing one.
    if (!row || !canCustomerAccessInquiry(row, userId)) {
      throw new NotFoundException("Inquiry not found");
    }
    return toInquiryDto(row);
  }

  async getMyAttachmentUrl(userId: string, inquiryId: string, attachmentId: string): Promise<ServiceFileDownloadResponse> {
    const attachment = await prisma.serviceInquiryAttachment.findFirst({
      where: { id: attachmentId, inquiryId },
      include: { inquiry: { select: { userId: true } } },
    });
    if (!attachment || !canCustomerAccessInquiry(attachment.inquiry, userId)) {
      throw new NotFoundException("Attachment not found");
    }
    return this.files.signedUrl(attachment.storageKey, attachment.fileName);
  }

  // --------------------------------------------------------------- admin

  async adminList(query: QueryServiceListDto): Promise<PaginatedList<AdminServiceInquiryDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.ServiceInquiryWhereInput = {};
    if (query.status && (Object.values(ServiceInquiryStatus) as string[]).includes(query.status)) {
      where.status = query.status as ServiceInquiryStatus;
    }
    if (query.serviceId) where.serviceId = query.serviceId;
    if (query.search) {
      where.OR = [
        { inquiryNumber: { contains: query.search, mode: "insensitive" } },
        { companyName: { contains: query.search, mode: "insensitive" } },
        { contactEmail: { contains: query.search, mode: "insensitive" } },
        { contactName: { contains: query.search, mode: "insensitive" } },
      ];
    }
    const [total, rows] = await Promise.all([
      prisma.serviceInquiry.count({ where }),
      prisma.serviceInquiry.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: INQUIRY_INCLUDE,
      }),
    ]);
    return { items: rows.map(toAdminInquiryDto), total, page, limit };
  }

  async adminGet(idOrNumber: string): Promise<AdminServiceInquiryDto> {
    const row = await this.findByIdOrNumber(idOrNumber);
    if (!row) throw new NotFoundException("Inquiry not found");
    return toAdminInquiryDto(row);
  }

  async adminGetAttachmentUrl(inquiryId: string, attachmentId: string): Promise<ServiceFileDownloadResponse> {
    const attachment = await prisma.serviceInquiryAttachment.findFirst({ where: { id: attachmentId, inquiryId } });
    if (!attachment) throw new NotFoundException("Attachment not found");
    return this.files.signedUrl(attachment.storageKey, attachment.fileName);
  }

  async adminUpdate(id: string, dto: AdminUpdateInquiryDto, actor: ActorContext): Promise<AdminServiceInquiryDto> {
    const existing = await prisma.serviceInquiry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Inquiry not found");

    if (dto.status && !isManualInquiryTransition(existing.status, dto.status)) {
      throw new BadRequestException(
        dto.status === ServiceInquiryStatus.CONVERTED
          ? "Use the convert action to turn an inquiry into a project"
          : `Invalid inquiry transition ${existing.status} -> ${dto.status}`,
      );
    }

    const data: Prisma.ServiceInquiryUncheckedUpdateManyInput = {
      reviewedById: actor.userId,
      reviewedAt: new Date(),
    };
    if (dto.status) data.status = dto.status;
    if (dto.staffNote !== undefined) data.staffNote = dto.staffNote ? sanitizeTicketContent(dto.staffNote) : null;

    await prisma.$transaction(async (tx) => {
      // Compare-and-set on the status we validated against: a concurrent change makes this a 409.
      const res = await tx.serviceInquiry.updateMany({ where: { id, status: existing.status }, data });
      if (res.count === 0) {
        throw new ConflictException("Inquiry was modified concurrently; reload and try again");
      }
      await this.audit.logActionWithClient(tx, {
        action: "SERVICE_INQUIRY_UPDATED",
        entity: "ServiceInquiry",
        entityId: id,
        actorId: actor.userId,
        details: { fromStatus: existing.status, toStatus: dto.status ?? existing.status, noteChanged: dto.staffNote !== undefined },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });
    return this.adminGet(id);
  }

  /**
   * Converts a QUALIFIED inquiry into a project in one transaction. Idempotent:
   * converting an already converted inquiry returns its existing project.
   */
  async convert(id: string, dto: ConvertInquiryDto, actor: ActorContext): Promise<AdminServiceProjectDto> {
    const inquiry = await prisma.serviceInquiry.findUnique({
      where: { id },
      include: { project: { select: { id: true } } },
    });
    if (!inquiry) throw new NotFoundException("Inquiry not found");
    if (inquiry.project) return loadAdminProject(inquiry.project.id);
    if (!canConvertInquiry(inquiry.status)) {
      throw new BadRequestException(`Only QUALIFIED inquiries can be converted (current: ${inquiry.status})`);
    }

    const customerId = await this.resolveCustomer(inquiry.userId, dto.customerEmail);
    if (dto.startDate && dto.targetDate && new Date(dto.targetDate) < new Date(dto.startDate)) {
      throw new BadRequestException("targetDate must not be before startDate");
    }

    let projectId: string;
    try {
      projectId = await withUniqueCodeRetry("project_code", "projectCode", () => prisma.$transaction(async (tx) => {
        const claimed = await tx.serviceInquiry.updateMany({
          where: { id, status: ServiceInquiryStatus.QUALIFIED },
          data: { status: ServiceInquiryStatus.CONVERTED, reviewedById: actor.userId, reviewedAt: new Date() },
        });
        if (claimed.count === 0) {
          throw new ConflictException("Inquiry was modified concurrently; reload and try again");
        }
        const project = await tx.serviceProject.create({
          data: {
            projectCode: generateTicketNumber("PRJ"),
            inquiryId: id,
            customerId,
            serviceId: inquiry.serviceId,
            title: dto.title || `${inquiry.companyName} — ${inquiry.inquiryNumber}`,
            summary: dto.summary ? sanitizeTicketContent(dto.summary) : null,
            startDate: dto.startDate ? new Date(dto.startDate) : null,
            targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
            createdById: actor.userId,
            events: {
              create: {
                actorId: actor.userId,
                type: ServiceProjectEventType.CREATED,
                toStatus: "PLANNING",
                details: { inquiryNumber: inquiry.inquiryNumber },
              },
            },
          },
        });
        await this.audit.logActionWithClient(tx, {
          action: "SERVICE_INQUIRY_CONVERTED",
          entity: "ServiceInquiry",
          entityId: id,
          actorId: actor.userId,
          details: { projectId: project.id, projectCode: project.projectCode, customerId },
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        });
        return project.id;
      }));
    } catch (err) {
      // Lost a race against a concurrent conversion: return the winner's project.
      const existing = await prisma.serviceProject.findUnique({ where: { inquiryId: id }, select: { id: true } });
      if (existing) return loadAdminProject(existing.id);
      throw err;
    }
    return loadAdminProject(projectId);
  }

  /**
   * The project owner is the signed-in submitter, or — for anonymous inquiries —
   * an existing account the admin names explicitly. Never auto-linked by the
   * inquiry's unverified contact email.
   */
  private async resolveCustomer(inquiryUserId: string | null, customerEmail?: string): Promise<string> {
    if (inquiryUserId) return inquiryUserId;
    if (!customerEmail) {
      throw new BadRequestException("customerEmail is required for inquiries submitted without an account");
    }
    const user = await prisma.user.findUnique({ where: { email: customerEmail }, select: { id: true } });
    if (!user) {
      throw new BadRequestException("No account exists for customerEmail; ask the customer to sign up first");
    }
    return user.id;
  }

  // ------------------------------------------------------------- helpers

  private findByIdOrNumber(idOrNumber: string) {
    return prisma.serviceInquiry.findFirst({
      where: { OR: [{ id: idOrNumber }, { inquiryNumber: idOrNumber }] },
      include: INQUIRY_INCLUDE,
    });
  }

}
