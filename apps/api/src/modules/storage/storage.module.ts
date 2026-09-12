import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { STORAGE_SERVICE } from "./storage.interface";
import { S3CompatibleStorageService } from "./s3-storage.service";

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: STORAGE_SERVICE,
      useClass: S3CompatibleStorageService,
    },
  ],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
