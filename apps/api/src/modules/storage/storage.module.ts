import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { STORAGE_SERVICE } from "./storage.interface";
import { MinioStorageService } from "./minio-storage.service";

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: STORAGE_SERVICE,
      useClass: MinioStorageService,
    },
  ],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
