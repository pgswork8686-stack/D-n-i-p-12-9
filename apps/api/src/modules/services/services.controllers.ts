import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import { Request } from "express";
import { SERVICE_FILE_MAX_BYTES, SERVICE_INQUIRY_MAX_FILES } from "@nexus/contracts";
import { RequireFeature } from "../../common/feature-flags";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import {
  AdminUpdateInquiryDto,
  AdminUpdateProjectDto,
  AssignProjectMemberDto,
  ConvertInquiryDto,
  CreateMilestoneDto,
  CreateServiceDto,
  CreateServiceInquiryDto,
  PostProjectMessageDto,
  QueryServiceListDto,
  UpdateMilestoneDto,
  UpdateServiceDto,
  UploadProjectDocumentDto,
} from "./dto/services.dto";
import { OptionalAuthGuard } from "./optional-auth.guard";
import { UploadQuota, UploadQuotaGuard } from "./upload-quota.guard";
import { ActorContext, ServiceCatalogService } from "./service-catalog.service";
import { ServiceInquiriesService } from "./service-inquiries.service";
import { ServiceProjectsService } from "./service-projects.service";
import { UploadedServiceFile } from "./service-files";

const UPLOAD_LIMITS = {
  fileSize: SERVICE_FILE_MAX_BYTES,
  files: SERVICE_INQUIRY_MAX_FILES,
  fields: 30,
  fieldSize: 64 * 1024,
};

/**
 * Multer buffers files before the handler runs, so the public form must refuse
 * anonymous file parts here — otherwise anyone could push 5 x 10 MB into memory
 * per request without ever reaching the rate limiter. Guards run before
 * interceptors, so req.user is already resolved by OptionalAuthGuard.
 */
export function signedInOnlyFileFilter(
  req: Request,
  _file: unknown,
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (!req.user) {
    callback(new BadRequestException("Vui lòng đăng nhập để đính kèm tài liệu."), false);
    return;
  }
  callback(null, true);
}

function actorOf(req: Request): ActorContext {
  return {
    userId: req.user!.id,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"] as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// Public storefront
// ---------------------------------------------------------------------------

@Controller(["services", "v1/services"])
@RequireFeature("services")
export class PublicServicesController {
  constructor(private readonly catalog: ServiceCatalogService) {}

  @Get()
  list() {
    return this.catalog.listPublic();
  }

  @Get(":slug")
  get(@Param("slug") slug: string) {
    return this.catalog.getPublicBySlug(slug);
  }
}

@Controller("v1/service-inquiries")
@RequireFeature("services")
@UseGuards(OptionalAuthGuard)
export class PublicServiceInquiriesController {
  constructor(private readonly inquiries: ServiceInquiriesService) {}

  /** Anonymous or signed-in. Attachments (multipart `files`) require a signed-in user. */
  @Post()
  @HttpCode(201)
  @UseGuards(UploadQuotaGuard)
  @UploadQuota({ scope: "inquiry", limitEnv: "SERVICE_INQUIRY_UPLOAD_LIMIT_PER_USER", defaultLimit: 10 })
  @UseInterceptors(
    FilesInterceptor("files", SERVICE_INQUIRY_MAX_FILES, { limits: UPLOAD_LIMITS, fileFilter: signedInOnlyFileFilter }),
  )
  submit(
    @Req() req: Request,
    @Body() dto: CreateServiceInquiryDto,
    @UploadedFiles() files: UploadedServiceFile[] = [],
  ) {
    return this.inquiries.submit(dto, files, {
      userId: req.user?.id ?? null,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] as string | undefined,
    });
  }
}

// ---------------------------------------------------------------------------
// Customer portal (ownership enforced in the services: other customers' rows are 404)
// ---------------------------------------------------------------------------

@Controller("v1/me/service-inquiries")
@RequireFeature("services")
@UseGuards(AuthGuard)
export class MyServiceInquiriesController {
  constructor(private readonly inquiries: ServiceInquiriesService) {}

  @Get()
  list(@Req() req: Request, @Query() query: QueryServiceListDto) {
    return this.inquiries.listMine(req.user!.id, query);
  }

  @Get(":id")
  get(@Req() req: Request, @Param("id") id: string) {
    return this.inquiries.getMine(req.user!.id, id);
  }

  @Get(":id/attachments/:attachmentId/url")
  attachmentUrl(@Req() req: Request, @Param("id") id: string, @Param("attachmentId") attachmentId: string) {
    return this.inquiries.getMyAttachmentUrl(req.user!.id, id, attachmentId);
  }
}

@Controller("v1/me/service-projects")
@RequireFeature("services")
@UseGuards(AuthGuard)
export class MyServiceProjectsController {
  constructor(private readonly projects: ServiceProjectsService) {}

  @Get()
  list(@Req() req: Request, @Query() query: QueryServiceListDto) {
    return this.projects.listMine(req.user!.id, query);
  }

  @Get(":id")
  get(@Req() req: Request, @Param("id") id: string) {
    return this.projects.getMine(req.user!.id, id);
  }

  @Post(":id/messages")
  postMessage(@Req() req: Request, @Param("id") id: string, @Body() dto: PostProjectMessageDto) {
    return this.projects.customerPostMessage(req.user!.id, id, dto);
  }

  @Post(":id/documents")
  @UseGuards(UploadQuotaGuard)
  @UploadQuota({ scope: "project-document", limitEnv: "SERVICE_PROJECT_UPLOAD_LIMIT_PER_USER", defaultLimit: 20 })
  @UseInterceptors(FileInterceptor("file", { limits: { ...UPLOAD_LIMITS, files: 1 } }))
  uploadDocument(@Req() req: Request, @Param("id") id: string, @UploadedFile() file: UploadedServiceFile) {
    return this.projects.customerUploadDocument(req.user!.id, id, file, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] as string | undefined,
    });
  }

  @Get(":id/documents/:documentId/url")
  documentUrl(@Req() req: Request, @Param("id") id: string, @Param("documentId") documentId: string) {
    return this.projects.customerDocumentUrl(req.user!.id, id, documentId);
  }
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

@Controller("v1/admin/services")
@RequireFeature("services")
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminServicesController {
  constructor(private readonly catalog: ServiceCatalogService) {}

  @Get()
  @RequirePermissions("service.read")
  list(@Query() query: QueryServiceListDto) {
    return this.catalog.adminList(query);
  }

  @Get(":id")
  @RequirePermissions("service.read")
  get(@Param("id") id: string) {
    return this.catalog.adminGet(id);
  }

  @Post()
  @RequirePermissions("service.manage")
  create(@Req() req: Request, @Body() dto: CreateServiceDto) {
    return this.catalog.create(dto, actorOf(req));
  }

  @Patch(":id")
  @RequirePermissions("service.manage")
  update(@Req() req: Request, @Param("id") id: string, @Body() dto: UpdateServiceDto) {
    return this.catalog.update(id, dto, actorOf(req));
  }
}

@Controller("v1/admin/service-inquiries")
@RequireFeature("services")
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminServiceInquiriesController {
  constructor(private readonly inquiries: ServiceInquiriesService) {}

  @Get()
  @RequirePermissions("inquiry.read")
  list(@Query() query: QueryServiceListDto) {
    return this.inquiries.adminList(query);
  }

  @Get(":id")
  @RequirePermissions("inquiry.read")
  get(@Param("id") id: string) {
    return this.inquiries.adminGet(id);
  }

  @Get(":id/attachments/:attachmentId/url")
  @RequirePermissions("inquiry.read")
  attachmentUrl(@Param("id") id: string, @Param("attachmentId") attachmentId: string) {
    return this.inquiries.adminGetAttachmentUrl(id, attachmentId);
  }

  @Patch(":id")
  @RequirePermissions("inquiry.manage")
  update(@Req() req: Request, @Param("id") id: string, @Body() dto: AdminUpdateInquiryDto) {
    return this.inquiries.adminUpdate(id, dto, actorOf(req));
  }

  @Post(":id/convert")
  @RequirePermissions("inquiry.manage", "project.manage")
  convert(@Req() req: Request, @Param("id") id: string, @Body() dto: ConvertInquiryDto) {
    return this.inquiries.convert(id, dto, actorOf(req));
  }
}

@Controller("v1/admin/service-projects")
@RequireFeature("services")
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminServiceProjectsController {
  constructor(private readonly projects: ServiceProjectsService) {}

  @Get()
  @RequirePermissions("project.read")
  list(@Query() query: QueryServiceListDto) {
    return this.projects.adminList(query);
  }

  @Get(":id")
  @RequirePermissions("project.read")
  get(@Param("id") id: string) {
    return this.projects.adminGet(id);
  }

  @Patch(":id")
  @RequirePermissions("project.manage")
  update(@Req() req: Request, @Param("id") id: string, @Body() dto: AdminUpdateProjectDto) {
    return this.projects.adminUpdate(id, dto, actorOf(req));
  }

  @Post(":id/members")
  @RequirePermissions("project.manage")
  assign(@Req() req: Request, @Param("id") id: string, @Body() dto: AssignProjectMemberDto) {
    return this.projects.assignMember(id, dto, actorOf(req));
  }

  @Delete(":id/members/:userId")
  @RequirePermissions("project.manage")
  unassign(@Req() req: Request, @Param("id") id: string, @Param("userId") userId: string) {
    return this.projects.removeMember(id, userId, actorOf(req));
  }

  @Post(":id/milestones")
  @RequirePermissions("project.manage")
  createMilestone(@Req() req: Request, @Param("id") id: string, @Body() dto: CreateMilestoneDto) {
    return this.projects.createMilestone(id, dto, actorOf(req));
  }

  @Patch(":id/milestones/:milestoneId")
  @RequirePermissions("project.manage")
  updateMilestone(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("milestoneId") milestoneId: string,
    @Body() dto: UpdateMilestoneDto,
  ) {
    return this.projects.updateMilestone(id, milestoneId, dto, actorOf(req));
  }

  @Post(":id/messages")
  @RequirePermissions("project.manage")
  postMessage(@Req() req: Request, @Param("id") id: string, @Body() dto: PostProjectMessageDto) {
    return this.projects.staffPostMessage(id, dto, actorOf(req));
  }

  @Post(":id/documents")
  @RequirePermissions("project.manage")
  @UseInterceptors(FileInterceptor("file", { limits: { ...UPLOAD_LIMITS, files: 1 } }))
  uploadDocument(
    @Req() req: Request,
    @Param("id") id: string,
    @UploadedFile() file: UploadedServiceFile,
    @Body() dto: UploadProjectDocumentDto,
  ) {
    return this.projects.staffUploadDocument(id, file, dto.visibility, actorOf(req));
  }

  @Get(":id/documents/:documentId/url")
  @RequirePermissions("project.read")
  documentUrl(@Param("id") id: string, @Param("documentId") documentId: string) {
    return this.projects.staffDocumentUrl(id, documentId);
  }
}

@Controller("v1/admin/service-staff")
@RequireFeature("services")
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminServiceStaffController {
  constructor(private readonly projects: ServiceProjectsService) {}

  @Get()
  @RequirePermissions("project.manage")
  list() {
    return this.projects.listStaff();
  }
}
