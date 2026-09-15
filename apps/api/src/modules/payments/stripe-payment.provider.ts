import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import * as crypto from "crypto";
import Stripe from "stripe";
import { Order, Payment, PaymentStatus } from "@nexus/database";
import {
  PaymentProviderAdapter,
  NormalizedPaymentSession,
  NormalizedPaymentEvent,
  NormalizedPaymentStatus,
} from "./payment-provider.interface";

@Injectable()
export class StripePaymentProvider implements PaymentProviderAdapter {
  readonly providerName = "stripe";
  private readonly logger = new Logger(StripePaymentProvider.name);
  private stripeClient: Stripe | null = null;

  constructor() {
    this.initStripe();
  }

  private initStripe() {
    const secretKey =
      process.env.STRIPE_SECRET_KEY || "sk_test_placeholder_key_nexus_ecommerce";
    this.stripeClient = new Stripe(secretKey, {
      apiVersion: "2025-02-24.acacia" as any,
    });
  }

  /**
   * Helper to generate authentic Stripe test webhook signature headers.
   * Uses the official Stripe SDK test header utility.
   */
  static generateTestHeader(params: {
    payload: string | Buffer;
    secret: string;
    timestamp?: number;
  }): string {
    const stripe = new Stripe("sk_test_dummy", {
      apiVersion: "2025-02-24.acacia" as any,
    });
    return stripe.webhooks.generateTestHeaderString({
      payload:
        typeof params.payload === "string"
          ? params.payload
          : params.payload.toString("utf8"),
      secret: params.secret,
      timestamp: params.timestamp,
    });
  }

  async createPaymentSession(params: {
    order: Order;
    payment: Payment;
    successUrl?: string;
    cancelUrl?: string;
  }): Promise<NormalizedPaymentSession> {
    const { order, payment, successUrl, cancelUrl } = params;

    // Support mock client mode for offline integration test suites
    if (
      process.env.STRIPE_MOCK_CLIENT === "true" ||
      !process.env.STRIPE_SECRET_KEY ||
      process.env.STRIPE_SECRET_KEY.startsWith("sk_test_placeholder")
    ) {
      this.logger.log(
        `Creating simulated Stripe checkout session for payment ${payment.id} (MOCK_MODE)`,
      );
      const sessionId = `cs_test_${payment.id}`;
      return {
        sessionId,
        sessionUrl: `https://checkout.stripe.com/c/pay/${sessionId}`,
        providerReference: sessionId,
      };
    }

    if (!this.stripeClient) {
      throw new ForbiddenException("Stripe client is not configured");
    }

    try {
      const session = await this.stripeClient.checkout.sessions.create(
        {
          mode: "payment",
          client_reference_id: order.id,
          metadata: {
            orderId: order.id,
            paymentId: payment.id,
          },
          line_items: [
            {
              price_data: {
                currency: payment.currency.toLowerCase(),
                unit_amount: payment.amount,
                product_data: {
                  name: `Order #${order.orderNumber}`,
                },
              },
              quantity: 1,
            },
          ],
          success_url:
            successUrl ||
            `http://localhost:3000/orders/${order.id}?session_id={CHECKOUT_SESSION_ID}&status=success`,
          cancel_url:
            cancelUrl ||
            `http://localhost:3000/orders/${order.id}?status=cancelled`,
        },
        {
          idempotencyKey: `payment-session-${payment.id}`,
        },
      );

      return {
        sessionId: session.id,
        sessionUrl: session.url || "",
        providerReference: session.id,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to create Stripe Checkout Session for order ${order.id}: ${err.message}`,
      );
      throw new BadRequestException(
        `Stripe session creation failed: ${err.message}`,
      );
    }
  }

  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<NormalizedPaymentEvent> {
    const signature =
      (headers["stripe-signature"] as string) ||
      (headers["Stripe-Signature"] as string);

    if (!signature) {
      throw new BadRequestException("Missing stripe-signature header");
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret || webhookSecret.trim() === "") {
      throw new ForbiddenException("STRIPE_WEBHOOK_SECRET is not configured");
    }

    if (!this.stripeClient) {
      throw new ForbiddenException("Stripe client is not initialized");
    }

    let event: Stripe.Event;
    try {
      // Official Stripe raw body signature & tolerance verification
      // Tolerance defaults to 300 seconds (5 minutes)
      const tolerance = process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS
        ? parseInt(process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS, 10)
        : 300;

      event = this.stripeClient.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret,
        tolerance,
      );
    } catch (err: any) {
      this.logger.warn(`Stripe webhook signature verification failed: ${err.message}`);
      throw new BadRequestException(`Invalid webhook signature: ${err.message}`);
    }

    const rawPayloadHash = crypto
      .createHash("sha256")
      .update(rawBody)
      .digest("hex");

    return this.parseWebhookEvent(event, rawPayloadHash);
  }

  private parseWebhookEvent(
    event: Stripe.Event,
    rawPayloadHash: string,
  ): NormalizedPaymentEvent {
    let eventType: NormalizedPaymentEvent["eventType"] = "ignored";
    let orderId = "";
    let paymentId = "";
    let amount = 0;
    let currency = "";
    let providerReference = "";

    const dataObject = event.data.object as any;

    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      eventType = "payment.succeeded";
      orderId = dataObject.client_reference_id || dataObject.metadata?.orderId || "";
      paymentId = dataObject.metadata?.paymentId || "";
      amount = dataObject.amount_total ?? 0;
      currency = (dataObject.currency || "").toUpperCase();
      providerReference = dataObject.id;
    } else if (event.type === "checkout.session.async_payment_failed") {
      eventType = "payment.failed";
      orderId = dataObject.client_reference_id || dataObject.metadata?.orderId || "";
      paymentId = dataObject.metadata?.paymentId || "";
      amount = dataObject.amount_total ?? 0;
      currency = (dataObject.currency || "").toUpperCase();
      providerReference = dataObject.id;
    } else if (event.type === "checkout.session.expired") {
      eventType = "payment.cancelled";
      orderId = dataObject.client_reference_id || dataObject.metadata?.orderId || "";
      paymentId = dataObject.metadata?.paymentId || "";
      amount = dataObject.amount_total ?? 0;
      currency = (dataObject.currency || "").toUpperCase();
      providerReference = dataObject.id;
    } else if (event.type === "payment_intent.succeeded") {
      eventType = "payment.succeeded";
      orderId = dataObject.metadata?.orderId || "";
      paymentId = dataObject.metadata?.paymentId || "";
      amount = dataObject.amount ?? 0;
      currency = (dataObject.currency || "").toUpperCase();
      providerReference = dataObject.id;
    } else if (event.type === "payment_intent.payment_failed") {
      eventType = "payment.failed";
      orderId = dataObject.metadata?.orderId || "";
      paymentId = dataObject.metadata?.paymentId || "";
      amount = dataObject.amount ?? 0;
      currency = (dataObject.currency || "").toUpperCase();
      providerReference = dataObject.id;
    } else if (event.type === "payment_intent.canceled") {
      eventType = "payment.cancelled";
      orderId = dataObject.metadata?.orderId || "";
      paymentId = dataObject.metadata?.paymentId || "";
      amount = dataObject.amount ?? 0;
      currency = (dataObject.currency || "").toUpperCase();
      providerReference = dataObject.id;
    }

    // Secret hygiene: sanitize payload, strictly omitting sensitive card details or customer PII
    const sanitizedPayload: Record<string, any> = {
      id: event.id,
      type: event.type,
      apiVersion: event.api_version,
      created: event.created,
      objectId: dataObject.id,
      objectType: dataObject.object,
      status: dataObject.status,
      paymentStatus: dataObject.payment_status,
      amountTotal: dataObject.amount_total ?? dataObject.amount,
      currency: (dataObject.currency || "").toUpperCase(),
      orderId,
      paymentId,
      rawPayloadHash,
    };

    return {
      externalEventId: event.id,
      eventType,
      orderId,
      paymentId,
      amount,
      currency,
      providerReference,
      rawPayloadHash,
      sanitizedPayload,
    };
  }

  async queryPaymentStatus(
    providerReference: string,
  ): Promise<NormalizedPaymentStatus | null> {
    if (
      process.env.STRIPE_MOCK_CLIENT === "true" ||
      !process.env.STRIPE_SECRET_KEY ||
      process.env.STRIPE_SECRET_KEY.startsWith("sk_test_placeholder")
    ) {
      return {
        providerReference,
        status: PaymentStatus.SUCCEEDED,
        amount: 0,
        currency: "USD",
        externalEventId: `reconcile_${providerReference}`,
      };
    }

    if (!this.stripeClient) {
      return null;
    }

    try {
      if (providerReference.startsWith("cs_")) {
        const session =
          await this.stripeClient.checkout.sessions.retrieve(providerReference);
        let status: PaymentStatus = PaymentStatus.PENDING;
        if (session.payment_status === "paid" || session.status === "complete") {
          status = PaymentStatus.SUCCEEDED;
        } else if (session.status === "expired") {
          status = PaymentStatus.FAILED;
        }
        return {
          providerReference,
          status,
          amount: session.amount_total ?? 0,
          currency: (session.currency || "").toUpperCase(),
          externalEventId: `reconcile_${session.id}_${session.payment_status}`,
        };
      } else if (providerReference.startsWith("pi_")) {
        const pi =
          await this.stripeClient.paymentIntents.retrieve(providerReference);
        let status: PaymentStatus = PaymentStatus.PENDING;
        if (pi.status === "succeeded") {
          status = PaymentStatus.SUCCEEDED;
        } else if (pi.status === "canceled") {
          status = PaymentStatus.CANCELLED;
        }
        return {
          providerReference,
          status,
          amount: pi.amount ?? 0,
          currency: (pi.currency || "").toUpperCase(),
          externalEventId: `reconcile_${pi.id}_${pi.status}`,
        };
      }
      return null;
    } catch (err: any) {
      this.logger.error(
        `Failed to query Stripe status for reference ${providerReference}: ${err.message}`,
      );
      return null;
    }
  }
}
