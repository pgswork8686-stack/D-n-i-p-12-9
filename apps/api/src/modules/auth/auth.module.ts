import { Module, Global } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import {
  DevMockAuthProvider,
  ProductionFailClosedAuthProvider,
} from "@nexus/auth";
import { AUTH_SERVICE } from "./auth.constants";
import { AuthGuard } from "./auth.guard";

export * from "./auth.constants";

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: AUTH_SERVICE,
      useFactory: (configService: ConfigService) => {
        const nodeEnv = configService.get<string>("NODE_ENV", "development");
        if (nodeEnv === "production") {
          return new ProductionFailClosedAuthProvider();
        }
        return new DevMockAuthProvider();
      },
      inject: [ConfigService],
    },
    AuthGuard,
  ],
  exports: [AUTH_SERVICE, AuthGuard],
})
export class AuthModule {}
