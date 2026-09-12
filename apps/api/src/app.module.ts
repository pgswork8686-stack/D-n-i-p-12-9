import { Module, NestModule, MiddlewareConsumer } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import * as path from "path";
import { HealthModule } from "./modules/health/health.module";
import { StorageModule } from "./modules/storage/storage.module";
import { AuditModule } from "./modules/audit/audit.module";
import { UsersModule } from "./modules/users/users.module";
import { AuthModule } from "./modules/auth/auth.module";
import { QueueModule } from "./modules/queue/queue.module";
import { CorrelationIdMiddleware } from "./common/middleware/correlation-id.middleware";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.resolve(process.cwd(), ".env"),
        path.resolve(__dirname, "../../../.env"),
      ],
    }),
    AuditModule,
    UsersModule,
    HealthModule,
    StorageModule,
    AuthModule,
    QueueModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes("*");
  }
}
