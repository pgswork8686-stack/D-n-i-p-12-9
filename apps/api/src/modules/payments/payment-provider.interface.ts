import { Order, Payment, PaymentStatus } from "@nexus/database";

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

export interface NormalizedPaymentSession {
  sessionId: string;
  sessionUrl: string;
  providerReference: string;
}

export interface NormalizedPaymentEvent {
  externalEventId: string;
  eventType: "payment.succeeded" | "payment.failed" | "payment.cancelled" | "ignored";
  orderId: string;
  paymentId: string;
  amount: number;
  currency: string;
  providerReference: string;
  rawPayloadHash?: string;
  sanitizedPayload: Record<string, any>;
}

export interface NormalizedPaymentStatus {
  providerReference: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  externalEventId?: string;
}

export interface PaymentProviderAdapter {
  readonly providerName: string;

  createPaymentSession(params: {
    order: Order;
    payment: Payment;
    successUrl?: string;
    cancelUrl?: string;
  }): Promise<NormalizedPaymentSession>;

  getPaymentSession?(
    providerReference: string,
  ): Promise<NormalizedPaymentSession | null>;

  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<NormalizedPaymentEvent>;

  queryPaymentStatus?(
    providerReference: string,
  ): Promise<NormalizedPaymentStatus | null>;
}

