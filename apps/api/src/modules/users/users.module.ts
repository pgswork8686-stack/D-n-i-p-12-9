import { Module, Global } from "@nestjs/common";
import { UsersService } from "./users.service";
import { AdminUsersController } from "./admin-users.controller";
import { AuditModule } from "../audit/audit.module";

@Global()
@Module({
  imports: [AuditModule],
  controllers: [AdminUsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}