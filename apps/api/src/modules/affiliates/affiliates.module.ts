import { Module } from "@nestjs/common";
import { AffiliatesController } from "./affiliates.controller";
import { AdminAffiliatesController } from "./admin-affiliates.controller";
import { AffiliatesService } from "./affiliates.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  controllers: [AffiliatesController, AdminAffiliatesController],
  providers: [AffiliatesService],
  exports: [AffiliatesService],
})
export class AffiliatesModule {}
