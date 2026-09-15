import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { PaymentsService } from "./payments.service";
import { PaymentsController } from "./payments.controller";
import { PaymentWebhooksController } from "./payment-webhooks.controller";
import { PaymentSessionController } from "./payment-session.controller";
import { TestPaymentProvider } from "./test-payment.provider";
import { StripePaymentProvider } from "./stripe-payment.provider";
import { PaymentProviderFactory } from "./payment-provider.factory";

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [
    PaymentsController,
    PaymentWebhooksController,
    PaymentSessionController,
  ],
  providers: [
    PaymentsService,
    TestPaymentProvider,
    StripePaymentProvider,
    PaymentProviderFactory,
  ],
  exports: [
    PaymentsService,
    TestPaymentProvider,
    StripePaymentProvider,
    PaymentProviderFactory,
  ],
})
export class PaymentsModule {}

