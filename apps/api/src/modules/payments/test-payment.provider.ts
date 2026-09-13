import { Injectable } from "@nestjs/common";
import { Order, Payment } from "@nexus/database";
import {
  PaymentProvider,
  PaymentInitiationResult,
  PaymentEventVerificationResult,
} from "./payment-provider.interface";

@Injectable()
export class TestPaymentProvider implements PaymentProvider {
  readonly name = "TEST";

  async initiatePayment(
    order: Order,
    payment: Payment,
  ): Promise<PaymentInitiationResult> {
    return {
      providerReference: `test_ref_${payment.id}`,
      paymentUrl: `/orders/${order.id}`,
    };
  }

  async verifyEvent(
    payload: any,
    headers?: Record<string, string>,
  ): Promise<PaymentEventVerificationResult> {
    return {
      verified: true,
      externalEventId: payload.externalEventId,
      eventType: payload.eventType,
      paymentId: payload.paymentId,
      payload: payload.metadata || {},
    };
  }
}
