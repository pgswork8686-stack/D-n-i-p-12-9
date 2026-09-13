import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { PaymentsService } from "./payments.service";
import { PaymentsController } from "./payments.controller";
import { TestPaymentProvider } from "./test-payment.provider";

@Module({
  imports: [AuditModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, TestPaymentProvider],
  exports: [PaymentsService, TestPaymentProvider],
})
export class PaymentsModule {}
