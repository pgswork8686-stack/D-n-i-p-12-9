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
import { SepayPaymentProvider } from "./sepay-payment.provider";
import { PaymentReconciliationService } from "./payment-reconciliation.service";
import { PaymentReconciliationController } from "./payment-reconciliation.controller";

@Module({
  imports: [AuditModule, AuthModule],
  controllers: [
    PaymentsController,
    PaymentReconciliationController,
    PaymentWebhooksController,
    PaymentSessionController,
  ],
  providers: [
    PaymentsService,
    PaymentReconciliationService,
    TestPaymentProvider,
    StripePaymentProvider,
    SepayPaymentProvider,
    PaymentProviderFactory,
  ],
  exports: [
    PaymentsService,
    TestPaymentProvider,
    StripePaymentProvider,
    SepayPaymentProvider,
    PaymentProviderFactory,
  ],
})
export class PaymentsModule {}

