import { Order, Payment } from "@nexus/database";

export interface PaymentInitiationResult {
  providerReference?: string;
  clientSecret?: string;
  paymentUrl?: string;
}

export interface PaymentEventVerificationResult {
  verified: boolean;
  externalEventId: string;
  eventType: string;
  paymentId?: string;
  payload: Record<string, any>;
}

export interface PaymentProvider {
  readonly name: string;

  initiatePayment(
    order: Order,
    payment: Payment,
  ): Promise<PaymentInitiationResult>;

  verifyEvent(
    payload: any,
    headers?: Record<string, string>,
  ): Promise<PaymentEventVerificationResult>;
}
