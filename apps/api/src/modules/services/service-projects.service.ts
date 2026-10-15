import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  prisma,
  Prisma,
  ServiceDocumentVisibility,
  ServiceMilestoneStatus,
  ServiceProjectEventType,
  ServiceProjectMemberRole,
  ServiceProjectStatus,
  ServiceSenderType,
  canCustomerAccessProject,
  isDocumentVisibleToCustomer,
  isProjectClosed,
  isValidMilestoneTransition,
  isValidProjectTransition,
} from "@nexus/database";
import { sanitizeTicketContent } from "@nexus/utils";
import {
  AdminServiceProjectDto,
  PaginatedList,
  ServiceFileDownloadResponse,
  ServiceProjectDto,
  ServiceProjectSummaryDto,
  StaffUserDto,
} from "@nexus/contracts";
import { AuditService } from "../audit/audit.service";
import {
  AdminUpdateProjectDto,
  AssignProjectMemberDto,
  CreateMilestoneDto,
  PostProjectMessageDto,
  QueryServiceListDto,
  UpdateMilestoneDto,
} from "./dto/services.dto";
import { ActorContext } from "./service-catalog.service";
import { ServiceFileStore } from "./service-file-store";
import { InquiryRateLimiter } from "./inquiry-rate-limiter";
import { UploadedServiceFile, validateServiceFile } from "./service-files";
import { toAdminProjectDto, toCustomerProjectDto, toProjectSummaryDto } from "./services.mappers";

const USER_DISPLAY = { select: { id: true, email: true, profile: { select: { displayName: true } } } } as const;

export const PROJECT_DETAIL_INCLUDE = {
  service: { select: { id: true, slug: true, name: true } },
  inquiry: { select: { inquiryNumber: true } },
  customer: USER_DISPLAY,
  members: { include: { user: USER_DISPLAY }, orderBy: { createdAt: "asc" } },
  milestones: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
  documents: { orderBy: { createdAt: "desc" } },
  messages: { include: { sender: USER_DISPLAY }, orderBy: { createdAt: "asc" } },
  events: { orderBy: { createdAt: "desc" }, take: 100 },
} satisfies Prisma.ServiceProjectInclude;

/** Same shape, with internal records excluded at the query level for customers. */
const CUSTOMER_PROJECT_INCLUDE = {
  ...PROJECT_DETAIL_INCLUDE,
  documents: { where: { visibility: ServiceDocumentVisibility.CUSTOMER }, orderBy: { createdAt: "desc" } },
  messages: { where: { isInternalNote: false }, include: { sender: USER_DISPLAY }, orderBy: { createdAt: "asc" } },
  events: { where: { isInternal: false }, orderBy: { createdAt: "desc" }, take: 100 },
} satisfies Prisma.ServiceProjectInclude;

const SUMMARY_INCLUDE = {
  service: { select: { id: true, slug: true, name: true } },
  milestones: { select: { status: true } },
} satisfies Prisma.ServiceProjectInclude;

/** Any role other than the default customer role counts as staff. */
const NON_STAFF_ROLES = ["customer"];

export async function loadAdminProject(id: string): Promise<AdminServiceProjectDto> {
  const project = await prisma.serviceProject.findUnique({ where: { id }, include: PROJECT_DETAIL_INCLUDE });
  if (!project) throw new NotFoundException("Project not found");
  return toAdminProjectDto(project);
}

@Injectable()
export class ServiceProjectsService {
  constructor(
    private readonly audit: AuditService,
    private readonly files: ServiceFileStore,
    private readonly rateLimiter: InquiryRateLimiter,
  ) {}

  // ------------------------------------------------------------ customer

  async listMine(userId: string, query: QueryServiceListDto): Promise<PaginatedList<ServiceProjectSummaryDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.ServiceProjectWhereInput = { customerId: userId };
    const [total, rows] = await Promise.all([
      prisma.serviceProject.count({ where }),
      prisma.serviceProject.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: SUMMARY_INCLUDE,
      }),
    ]);
    return { items: rows.map(toProjectSummaryDto), total, page, limit };
  }

  async getMine(userId: string, idOrCode: string): Promise<ServiceProjectDto> {
    const project = await prisma.serviceProject.findFirst({
      where: { OR: [{ id: idOrCode }, { projectCode: idOrCode }] },
      include: CUSTOMER_PROJECT_INCLUDE,
    });
    if (!project || !canCustomerAccessProject(project, userId)) {
      throw new NotFoundException("Project not found");
    }
    return toCustomerProjectDto(project);
  }

  async customerPostMessage(userId: string, projectId: string, dto: PostProjectMessageDto): Promise<ServiceProjectDto> {
    const project = await this.requireOwnedOpenProject(userId, projectId);
    await this.rateLimiter.consume({ key: `ratelimit:service-project:message:${userId}`, limit: 30, windowSeconds: 3600 });
    const body = this.cleanBody(dto.body);
    await prisma.$transaction(async (tx) => {
      await tx.serviceProjectMessage.create({
        data: { projectId: project.id, senderId: userId, senderType: ServiceSenderType.CUSTOMER, isInternalNote: false, body },
      });
      await tx.serviceProjectEvent.create({
        data: { projectId: project.id, actorId: userId, type: ServiceProjectEventType.MESSAGE_POSTED, details: { senderType: "CUSTOMER" } },
      });
      await tx.serviceProject.update({ where: { id: project.id }, data: { updatedAt: new Date() } });
    });
    return this.getMine(userId, project.id);
  }

  async customerUploadDocument(userId: string, projectId: string, file: UploadedServiceFile, ctx: Omit<ActorContext, "userId">): Promise<ServiceProjectDto> {
    const project = await this.requireOwnedOpenProject(userId, projectId);
    if (!file) throw new BadRequestException("Thiếu tệp tài liệu.");
    await this.rateLimiter.consume({ key: `ratelimit:service-project:upload:${userId}`, limit: 20, windowSeconds: 3600 });
    // Customers can only share documents with the project team, never mark them internal.
    await this.storeDocument(project.id, file, ServiceDocumentVisibility.CUSTOMER, ServiceSenderType.CUSTOMER, { userId, ...ctx });
    return this.getMine(userId, project.id);
  }

  async customerDocumentUrl(userId: string, projectId: string, documentId: string): Promise<ServiceFileDownloadResponse> {
    const doc = await prisma.serviceProjectDocument.findFirst({
      where: { id: documentId, projectId },
      include: { project: { select: { customerId: true } } },
    });
    if (!doc || !canCustomerAccessProject(doc.project, userId) || !isDocumentVisibleToCustomer(doc.visibility)) {
      throw new NotFoundException("Document not found");
    }
    return this.files.signedUrl(doc.storageKey, doc.fileName);
  }

  private async requireOwnedOpenProject(userId: string, projectId: string) {
    const project = await prisma.serviceProject.findUnique({
      where: { id: projectId },
      select: { id: true, customerId: true, status: true },
    });
    if (!project || !canCustomerAccessProject(project, userId)) {
      throw new NotFoundException("Project not found");
    }
    if (isProjectClosed(project.status)) {
      throw new BadRequestException("Dự án đã đóng, không thể gửi thêm nội dung.");
    }
    return project;
  }

  // --------------------------------------------------------------- admin

  async adminList(query: QueryServiceListDto): Promise<PaginatedList<ServiceProjectSummaryDto & { customerEmail: string | null }>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.ServiceProjectWhereInput = {};
    if (query.status && (Object.values(ServiceProjectStatus) as string[]).includes(query.status)) {
      where.status = query.status as ServiceProjectStatus;
    }
    if (query.serviceId) where.serviceId = query.serviceId;
    if (query.search) {
      where.OR = [
        { projectCode: { contains: query.search, mode: "insensitive" } },
        { title: { contains: query.search, mode: "insensitive" } },
        { customer: { email: { contains: query.search, mode: "insensitive" } } },
      ];
    }
    const [total, rows] = await Promise.all([
      prisma.serviceProject.count({ where }),
      prisma.serviceProject.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { ...SUMMARY_INCLUDE, customer: { select: { email: true } } },
      }),
    ]);
    return {
      items: rows.map((r) => ({ ...toProjectSummaryDto(r), customerEmail: r.customer?.email ?? null })),
      total,
      page,
      limit,
    };
  }

  adminGet(id: string): Promise<AdminServiceProjectDto> {
    return loadAdminProject(id);
  }

  async adminUpdate(id: string, dto: AdminUpdateProjectDto, actor: ActorContext): Promise<AdminServiceProjectDto> {
    const project = await prisma.serviceProject.findUnique({ where: { id } });
    if (!project) throw new NotFoundException("Project not found");

    const nextStatus = dto.status ?? project.status;
    if (!isValidProjectTransition(project.status, nextStatus)) {
      throw new BadRequestException(`Invalid project transition ${project.status} -> ${nextStatus}`);
    }

    const startDate = dto.startDate !== undefined ? (dto.startDate ? new Date(dto.startDate) : null) : project.startDate;
    const targetDate = dto.targetDate !== undefined ? (dto.targetDate ? new Date(dto.targetDate) : null) : project.targetDate;
    if (startDate && targetDate && targetDate < startDate) {
      throw new BadRequestException("targetDate must not be before startDate");
    }

    const data: Prisma.ServiceProjectUncheckedUpdateManyInput = {};
    if (dto.title !== undefined) data.title = sanitizeTicketContent(dto.title) || project.title;
    if (dto.summary !== undefined) data.summary = dto.summary ? sanitizeTicketContent(dto.summary) : null;
    if (dto.startDate !== undefined) data.startDate = startDate;
    if (dto.targetDate !== undefined) data.targetDate = targetDate;
    const statusChanged = nextStatus !== project.status;
    if (statusChanged) {
      data.status = nextStatus;
      if (nextStatus === ServiceProjectStatus.IN_PROGRESS && !startDate) data.startDate = new Date();
      if (nextStatus === ServiceProjectStatus.COMPLETED) data.completedAt = new Date();
    }

    await prisma.$transaction(async (tx) => {
      const res = await tx.serviceProject.updateMany({ where: { id, status: project.status }, data });
      if (res.count === 0) {
        throw new ConflictException("Project was modified concurrently; reload and try again");
      }
      if (statusChanged) {
        await tx.serviceProjectEvent.create({
          data: {
            projectId: id,
            actorId: actor.userId,
            type: ServiceProjectEventType.STATUS_CHANGED,
            fromStatus: project.status,
            toStatus: nextStatus,
          },
        });
      }
      await this.audit.logActionWithClient(tx, {
        action: statusChanged ? "SERVICE_PROJECT_STATUS_CHANGED" : "SERVICE_PROJECT_UPDATED",
        entity: "ServiceProject",
        entityId: id,
        actorId: actor.userId,
        details: { fromStatus: project.status, toStatus: nextStatus, changedFields: Object.keys(data) },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });
    return loadAdminProject(id);
  }

  async listStaff(): Promise<StaffUserDto[]> {
    const users = await prisma.user.findMany({
      where: { userRoles: { some: { role: { name: { notIn: NON_STAFF_ROLES } } } } },
      include: { profile: { select: { displayName: true } }, userRoles: { include: { role: { select: { name: true } } } } },
      orderBy: { email: "asc" },
      take: 500,
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.profile?.displayName ?? null,
      roles: u.userRoles.map((ur) => ur.role.name),
    }));
  }

  async assignMember(projectId: string, dto: AssignProjectMemberDto, actor: ActorContext): Promise<AdminServiceProjectDto> {
    await this.requireProject(projectId);
    const assignee = await prisma.user.findUnique({
      where: { id: dto.userId },
      include: { userRoles: { include: { role: { select: { name: true } } } } },
    });
    const isStaff = assignee?.userRoles.some((ur) => !NON_STAFF_ROLES.includes(ur.role.name));
    if (!assignee || !isStaff) {
      throw new BadRequestException("Only staff accounts can be assigned to a project");
    }
    const role = dto.role ?? ServiceProjectMemberRole.MEMBER;

    await prisma.$transaction(async (tx) => {
      await tx.serviceProjectMember.upsert({
        where: { projectId_userId: { projectId, userId: dto.userId } },
        update: { role, assignedById: actor.userId },
        create: { projectId, userId: dto.userId, role, assignedById: actor.userId },
      });
      await tx.serviceProjectEvent.create({
        data: { projectId, actorId: actor.userId, type: ServiceProjectEventType.MEMBER_ASSIGNED, details: { userId: dto.userId, role } },
      });
      await this.audit.logActionWithClient(tx, {
        action: "SERVICE_PROJECT_MEMBER_ASSIGNED",
        entity: "ServiceProject",
        entityId: projectId,
        actorId: actor.userId,
        details: { userId: dto.userId, role },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });
    return loadAdminProject(projectId);
  }

  async removeMember(projectId: string, userId: string, actor: ActorContext): Promise<AdminServiceProjectDto> {
    await this.requireProject(projectId);
    await prisma.$transaction(async (tx) => {
      const res = await tx.serviceProjectMember.deleteMany({ where: { projectId, userId } });
      if (res.count === 0) throw new NotFoundException("Member not found");
      await tx.serviceProjectEvent.create({
        data: { projectId, actorId: actor.userId, type: ServiceProjectEventType.MEMBER_REMOVED, details: { userId } },
      });
      await this.audit.logActionWithClient(tx, {
        action: "SERVICE_PROJECT_MEMBER_REMOVED",
        entity: "ServiceProject",
        entityId: projectId,
        actorId: actor.userId,
        details: { userId },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });
    return loadAdminProject(projectId);
  }

  async createMilestone(projectId: string, dto: CreateMilestoneDto, actor: ActorContext): Promise<AdminServiceProjectDto> {
    const project = await this.requireProject(projectId);
    if (isProjectClosed(project.status)) {
      throw new BadRequestException("Cannot add milestones to a closed project");
    }
    await prisma.$transaction(async (tx) => {
      const milestone = await tx.serviceMilestone.create({
        data: {
          projectId,
          title: sanitizeTicketContent(dto.title),
          description: dto.description ? sanitizeTicketContent(dto.description) : null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      await tx.serviceProjectEvent.create({
        data: { projectId, actorId: actor.userId, type: ServiceProjectEventType.MILESTONE_CREATED, details: { milestoneId: milestone.id, title: milestone.title } },
      });
      await this.audit.logActionWithClient(tx, {
        action: "SERVICE_MILESTONE_CREATED",
        entity: "ServiceMilestone",
        entityId: milestone.id,
        actorId: actor.userId,
        details: { projectId },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });
    return loadAdminProject(projectId);
  }

  async updateMilestone(projectId: string, milestoneId: string, dto: UpdateMilestoneDto, actor: ActorContext): Promise<AdminServiceProjectDto> {
    const milestone = await prisma.serviceMilestone.findFirst({ where: { id: milestoneId, projectId } });
    if (!milestone) throw new NotFoundException("Milestone not found");

    const nextStatus = dto.status ?? milestone.status;
    if (!isValidMilestoneTransition(milestone.status, nextStatus)) {
      throw new BadRequestException(`Invalid milestone transition ${milestone.status} -> ${nextStatus}`);
    }

    const data: Prisma.ServiceMilestoneUncheckedUpdateManyInput = {};
    if (dto.title !== undefined) data.title = sanitizeTicketContent(dto.title) || milestone.title;
    if (dto.description !== undefined) data.description = dto.description ? sanitizeTicketContent(dto.description) : null;
    if (dto.dueDate !== undefined) data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (nextStatus !== milestone.status) {
      data.status = nextStatus;
      data.completedAt = nextStatus === ServiceMilestoneStatus.DONE ? new Date() : null;
    }

    await prisma.$transaction(async (tx) => {
      const res = await tx.serviceMilestone.updateMany({ where: { id: milestoneId, status: milestone.status }, data });
      if (res.count === 0) {
        throw new ConflictException("Milestone was modified concurrently; reload and try again");
      }
      await tx.serviceProjectEvent.create({
        data: {
          projectId,
          actorId: actor.userId,
          type: ServiceProjectEventType.MILESTONE_UPDATED,
          fromStatus: milestone.status,
          toStatus: nextStatus,
          details: { milestoneId, title: (data.title as string) ?? milestone.title },
        },
      });
      await tx.serviceProject.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
      await this.audit.logActionWithClient(tx, {
        action: "SERVICE_MILESTONE_UPDATED",
        entity: "ServiceMilestone",
        entityId: milestoneId,
        actorId: actor.userId,
        details: { projectId, fromStatus: milestone.status, toStatus: nextStatus, changedFields: Object.keys(data) },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });
    return loadAdminProject(projectId);
  }

  async staffPostMessage(projectId: string, dto: PostProjectMessageDto, actor: ActorContext): Promise<AdminServiceProjectDto> {
    await this.requireProject(projectId);
    const body = this.cleanBody(dto.body);
    const isInternalNote = dto.isInternalNote === true;
    await prisma.$transaction(async (tx) => {
      await tx.serviceProjectMessage.create({
        data: { projectId, senderId: actor.userId, senderType: ServiceSenderType.STAFF, isInternalNote, body },
      });
      await tx.serviceProjectEvent.create({
        data: {
          projectId,
          actorId: actor.userId,
          type: ServiceProjectEventType.MESSAGE_POSTED,
          isInternal: isInternalNote,
          details: { senderType: "STAFF", internal: isInternalNote },
        },
      });
      await tx.serviceProject.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
    });
    return loadAdminProject(projectId);
  }

  async staffUploadDocument(
    projectId: string,
    file: UploadedServiceFile,
    visibility: ServiceDocumentVisibility | undefined,
    actor: ActorContext,
  ): Promise<AdminServiceProjectDto> {
    await this.requireProject(projectId);
    if (!file) throw new BadRequestException("Missing document file");
    await this.storeDocument(projectId, file, visibility ?? ServiceDocumentVisibility.INTERNAL, ServiceSenderType.STAFF, actor);
    return loadAdminProject(projectId);
  }

  async staffDocumentUrl(projectId: string, documentId: string): Promise<ServiceFileDownloadResponse> {
    const doc = await prisma.serviceProjectDocument.findFirst({ where: { id: documentId, projectId } });
    if (!doc) throw new NotFoundException("Document not found");
    return this.files.signedUrl(doc.storageKey, doc.fileName);
  }

  // ------------------------------------------------------------- helpers

  private async requireProject(id: string) {
    const project = await prisma.serviceProject.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!project) throw new NotFoundException("Project not found");
    return project;
  }

  private cleanBody(raw: string): string {
    const body = sanitizeTicketContent(raw);
    if (!body) throw new BadRequestException("Nội dung tin nhắn không được để trống.");
    return body;
  }

  private async storeDocument(
    projectId: string,
    file: UploadedServiceFile,
    visibility: ServiceDocumentVisibility,
    uploaderType: ServiceSenderType,
    actor: ActorContext,
  ): Promise<void> {
    const validated = validateServiceFile(file);
    const [stored] = await this.files.uploadAll("projects", projectId, [validated]);
    const isInternal = visibility === ServiceDocumentVisibility.INTERNAL;
    try {
      await prisma.$transaction(async (tx) => {
        const doc = await tx.serviceProjectDocument.create({
          data: {
            projectId,
            fileName: stored.fileName,
            storageKey: stored.storageKey,
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
            sha256: stored.sha256,
            visibility,
            uploadedById: actor.userId,
            uploaderType,
          },
        });
        await tx.serviceProjectEvent.create({
          data: {
            projectId,
            actorId: actor.userId,
            type: ServiceProjectEventType.DOCUMENT_ADDED,
            isInternal,
            details: { documentId: doc.id, fileName: doc.fileName, uploaderType },
          },
        });
        await tx.serviceProject.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
        await this.audit.logActionWithClient(tx, {
          action: "SERVICE_PROJECT_DOCUMENT_ADDED",
          entity: "ServiceProject",
          entityId: projectId,
          actorId: actor.userId,
          details: { documentId: doc.id, visibility, uploaderType, sizeBytes: doc.sizeBytes, sha256: doc.sha256 },
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        });
      });
    } catch (err) {
      await this.files.deleteObjects([stored.storageKey]);
      throw err;
    }
  }
}
