import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "../auth/auth.module";
import { QueueService } from "./queue.service";
import { QueueController } from "./queue.controller";

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [QueueController],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
