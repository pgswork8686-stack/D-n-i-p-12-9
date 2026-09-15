import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DownloadsService } from "./downloads.service";
import { DownloadRateLimiter } from "./download-rate-limiter";
import { AdminVersionsController } from "./admin-versions.controller";
import { DownloadsController } from "./downloads.controller";
import { UpdatesController } from "./updates.controller";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { StorageModule } from "../storage/storage.module";

@Module({
  imports: [ConfigModule, AuthModule, AuditModule, StorageModule],
  controllers: [
    AdminVersionsController,
    DownloadsController,
    UpdatesController,
  ],
  providers: [DownloadsService, DownloadRateLimiter],
  exports: [DownloadsService, DownloadRateLimiter],
})
export class DownloadsModule {}
