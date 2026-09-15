import {
  Injectable,
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import * as crypto from "crypto";
import { Order, Payment, PaymentStatus } from "@nexus/database";
import {
  PaymentProvider,
  PaymentInitiationResult,
  PaymentEventVerificationResult,
  PaymentProviderAdapter,
  NormalizedPaymentSession,
  NormalizedPaymentEvent,
  NormalizedPaymentStatus,
} from "./payment-provider.interface";

export function computeTestWebhookSignature(
  payload: { externalEventId: string; paymentId: string; eventType: string },
  secret: string = process.env.TEST_PAYMENT_WEBHOOK_SECRET || "",
): string {
  if (!secret) {
    throw new Error(
      "TEST_PAYMENT_WEBHOOK_SECRET is required to compute test signature",
    );
  }
  const content = `${payload.externalEventId}:${payload.paymentId}:${payload.eventType}`;
  return crypto.createHmac("sha256", secret).update(content).digest("hex");
}

@Injectable()
export class TestPaymentProvider implements PaymentProvider, PaymentProviderAdapter {
  readonly name = "TEST";
  readonly providerName = "test";

  private checkProductionBlock(): void {
    const isProduction = process.env.NODE_ENV === "production";
    const isExplicitlyEnabled =
      process.env.ENABLE_TEST_PAYMENT_PROVIDER === "true";

    if (isProduction || !isExplicitlyEnabled) {
      throw new ForbiddenException("Test payment provider is unavailable");
    }
  }

  private readonly mockSessions = new Map<
    string,
    {
      sessionId: string;
      sessionUrl: string;
      orderId: string;
      paymentId: string;
      amount: number;
      currency: string;
      status: PaymentStatus;
    }
  >();

  setMockStatus(
    providerReference: string,
    data: { status: PaymentStatus; amount: number; currency: string },
  ) {
    this.mockSessions.set(providerReference, {
      sessionId: providerReference,
      sessionUrl: `/orders/mock?session_id=${providerReference}`,
      orderId: "mock-order",
      paymentId: "mock-payment",
      amount: data.amount,
      currency: data.currency.toUpperCase(),
      status: data.status,
    });
  }

  async initiatePayment(
    order: Order,
    payment: Payment,
  ): Promise<PaymentInitiationResult> {
    this.checkProductionBlock();
    return {
      providerReference: `test_ref_${payment.id}`,
      paymentUrl: `/orders/${order.id}`,
    };
  }

  async createPaymentSession(params: {
    order: Order;
    payment: Payment;
    successUrl?: string;
    cancelUrl?: string;
  }): Promise<NormalizedPaymentSession> {
    this.checkProductionBlock();
    const { order, payment } = params;
    const sessionId = `test_session_${payment.id}`;
    const sessionUrl = `/orders/${order.id}?session_id=${sessionId}`;
    this.mockSessions.set(sessionId, {
      sessionId,
      sessionUrl,
      orderId: order.id,
      paymentId: payment.id,
      amount: payment.amount,
      currency: payment.currency.toUpperCase(),
      status: PaymentStatus.SUCCEEDED,
    });
    return {
      sessionId,
      sessionUrl,
      providerReference: sessionId,
    };
  }

  async getPaymentSession(
    providerReference: string,
  ): Promise<NormalizedPaymentSession | null> {
    this.checkProductionBlock();
    const mock = this.mockSessions.get(providerReference);
    if (mock) {
      return {
        sessionId: mock.sessionId,
        sessionUrl: mock.sessionUrl,
        providerReference: mock.sessionId,
      };
    }
    return null;
  }

  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<NormalizedPaymentEvent> {
    this.checkProductionBlock();

    const signature =
      (headers["x-test-signature"] as string) ||
      (headers["X-Test-Signature"] as string);
    if (!signature) {
      throw new BadRequestException("Missing x-test-signature header");
    }

    const secret = process.env.TEST_PAYMENT_WEBHOOK_SECRET;
    if (!secret || secret.trim() === "") {
      throw new ForbiddenException(
        "TEST_PAYMENT_WEBHOOK_SECRET must be explicitly configured when test payment provider is enabled",
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new BadRequestException("Malformed JSON in test payment webhook");
    }

    if (!parsed.externalEventId || !parsed.paymentId || !parsed.eventType) {
      throw new BadRequestException("Missing required test payment webhook fields");
    }

    const expectedSignature = computeTestWebhookSignature(parsed, secret);
    const sigBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      throw new BadRequestException("Invalid test payment webhook signature");
    }

    const rawPayloadHash = crypto
      .createHash("sha256")
      .update(rawBody)
      .digest("hex");

    return {
      externalEventId: parsed.externalEventId,
      eventType: parsed.eventType,
      orderId: parsed.orderId || "",
      paymentId: parsed.paymentId,
      amount: parsed.amount ?? 0,
      currency: (parsed.currency || "").toUpperCase(),
      providerReference: parsed.providerReference || `test_ref_${parsed.paymentId}`,
      rawPayloadHash,
      sanitizedPayload: {
        ...parsed.metadata,
        externalEventId: parsed.externalEventId,
        paymentId: parsed.paymentId,
        rawPayloadHash,
      },
    };
  }

  async queryPaymentStatus(
    providerReference: string,
  ): Promise<NormalizedPaymentStatus | null> {
    this.checkProductionBlock();
    const mock = this.mockSessions.get(providerReference);
    if (mock) {
      return {
        providerReference: mock.sessionId,
        status: mock.status,
        amount: mock.amount,
        currency: mock.currency,
        externalEventId: `reconcile_${providerReference}`,
      };
    }
    return null;
  }

  async verifyEvent(
    payload: any,
    headers?: Record<string, string>,
  ): Promise<PaymentEventVerificationResult> {
    this.checkProductionBlock();

    const secret = process.env.TEST_PAYMENT_WEBHOOK_SECRET;
    if (!secret || secret.trim() === "") {
      throw new ForbiddenException(
        "TEST_PAYMENT_WEBHOOK_SECRET must be explicitly configured when test payment provider is enabled",
      );
    }

    const signature =
      headers?.["x-test-signature"] || headers?.["X-Test-Signature"];
    if (!signature) {
      throw new UnauthorizedException("Missing x-test-signature header");
    }

    const expectedSignature = computeTestWebhookSignature(payload, secret);

    const sigBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException("Invalid test payment webhook signature");
    }

    return {
      verified: true,
      externalEventId: payload.externalEventId,
      eventType: payload.eventType,
      paymentId: payload.paymentId,
      payload: payload.metadata || {},
    };
  }
}

