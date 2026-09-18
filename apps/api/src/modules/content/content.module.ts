import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { ContentService } from "./content.service";
import { ContentController } from "./content.controller";
import { AdminContentController } from "./admin-content.controller";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [AdminContentController, ContentController],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}
