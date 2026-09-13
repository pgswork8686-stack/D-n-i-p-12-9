import {
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import * as crypto from "crypto";
import { Order, Payment } from "@nexus/database";
import {
  PaymentProvider,
  PaymentInitiationResult,
  PaymentEventVerificationResult,
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
    const isProduction = process.env.NODE_ENV === "production";
    const isExplicitlyEnabled =
      process.env.ENABLE_TEST_PAYMENT_PROVIDER === "true";

    if (isProduction || !isExplicitlyEnabled) {
      throw new ForbiddenException("Test payment provider is unavailable");
    }

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
