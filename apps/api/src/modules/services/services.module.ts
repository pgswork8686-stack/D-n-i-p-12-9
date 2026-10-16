import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { StorageModule } from "../storage/storage.module";
import {
  AdminServiceInquiriesController,
  AdminServiceProjectsController,
  AdminServicesController,
  AdminServiceStaffController,
  MyServiceInquiriesController,
  MyServiceProjectsController,
  PublicServiceInquiriesController,
  PublicServicesController,
} from "./services.controllers";
import { ServiceCatalogService } from "./service-catalog.service";
import { ServiceInquiriesService } from "./service-inquiries.service";
import { ServiceProjectsService } from "./service-projects.service";
import { ServiceFileStore } from "./service-file-store";
import { InquiryRateLimiter } from "./inquiry-rate-limiter";
import { OptionalAuthGuard } from "./optional-auth.guard";

/**
 * Services Foundation: service catalog, project inquiries and the project
 * management foundation. Gated by FEATURE_SERVICES (off in production by default).
 */
@Module({
  imports: [AuthModule, AuditModule, StorageModule],
  controllers: [
    PublicServicesController,
    PublicServiceInquiriesController,
    MyServiceInquiriesController,
    MyServiceProjectsController,
    AdminServicesController,
    AdminServiceInquiriesController,
    AdminServiceProjectsController,
    AdminServiceStaffController,
  ],
  providers: [
    ServiceCatalogService,
    ServiceInquiriesService,
    ServiceProjectsService,
    ServiceFileStore,
    InquiryRateLimiter,
    OptionalAuthGuard,
  ],
})
export class ServicesModule {}
