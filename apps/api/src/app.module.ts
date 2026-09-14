import { Module, NestModule, MiddlewareConsumer } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import * as path from "path";
import { HealthModule } from "./modules/health/health.module";
import { StorageModule } from "./modules/storage/storage.module";
import { AuditModule } from "./modules/audit/audit.module";
import { UsersModule } from "./modules/users/users.module";
import { AuthModule } from "./modules/auth/auth.module";
import { QueueModule } from "./modules/queue/queue.module";
import { CatalogModule } from "./modules/catalog/catalog.module";
import { CartModule } from "./modules/cart/cart.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { EntitlementsModule } from "./modules/entitlements/entitlements.module";
import { AllocationsModule } from "./modules/allocations/allocations.module";
import { LicensesModule } from "./modules/licenses/licenses.module";
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
    CatalogModule,
    CartModule,
    OrdersModule,
    PaymentsModule,
    EntitlementsModule,
    AllocationsModule,
    LicensesModule,
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
