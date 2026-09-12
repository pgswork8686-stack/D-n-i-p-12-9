import { Module, Global } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import {
  DevMockAuthProvider,
  ProductionFailClosedAuthProvider,
  SupabaseAuthProvider,
} from "@nexus/auth";
import { AUTH_SERVICE } from "./auth.constants";
import { AuthGuard } from "./auth.guard";
import { PermissionsGuard } from "./permissions.guard";
import { AuthController } from "./auth.controller";
import { RbacTestController } from "./rbac-test.controller";
import { UsersModule } from "../users/users.module";
import { AuditModule } from "../audit/audit.module";

export * from "./auth.constants";

@Global()
@Module({
  imports: [ConfigModule, UsersModule, AuditModule],
  controllers: [AuthController, RbacTestController],
  providers: [
    {
      provide: AUTH_SERVICE,
      useFactory: (configService: ConfigService) => {
        const nodeEnv = configService.get<string>("NODE_ENV", "development");
        const supabaseUrl = configService.get<string>("SUPABASE_URL");
        const supabaseServiceRoleKey = configService.get<string>(
          "SUPABASE_SERVICE_ROLE_KEY",
        );

        // If Supabase keys are configured, use Supabase provider
        if (supabaseUrl && supabaseServiceRoleKey) {
          return new SupabaseAuthProvider({
            supabaseUrl,
            supabaseServiceRoleKey,
          });
        }

        // Production must NEVER accept dev tokens
        if (nodeEnv === "production") {
          return new ProductionFailClosedAuthProvider();
        }

        // Default development / test mock provider
        return new DevMockAuthProvider();
      },
      inject: [ConfigService],
    },
    AuthGuard,
    PermissionsGuard,
  ],
  exports: [AUTH_SERVICE, AuthGuard, PermissionsGuard],
})
export class AuthModule {}

