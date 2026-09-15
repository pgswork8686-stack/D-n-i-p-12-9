import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  BadGatewayException,
  Logger,
} from "@nestjs/common";
import * as crypto from "crypto";
import Stripe from "stripe";
import { Order, Payment, PaymentStatus } from "@nexus/database";
import { resolveStripeWebhookTolerance } from "@nexus/contracts";
import {
  PaymentProviderAdapter,
  NormalizedPaymentSession,
  NormalizedPaymentEvent,
  NormalizedPaymentStatus,
} from "./payment-provider.interface";

export interface StripeConfig {
  isMock: boolean;
  secretKey?: string;
  webhookSecret?: string;
  webhookToleranceSeconds: number;
}

export interface MockStripeSession {
  sessionId: string;
  sessionUrl: string;
  orderId: string;
  paymentId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
}

@Injectable()
export class StripePaymentProvider implements PaymentProviderAdapter {
  readonly providerName = "stripe";
  private readonly logger = new Logger(StripePaymentProvider.name);
  private stripeClient: Stripe | null = null;
  private readonly mockSessions = new Map<string, MockStripeSession>();

  constructor() {
    this.initStripe();
  }

  resolveConfig(): StripeConfig {
    const isProd = process.env.NODE_ENV === "production";
    const mockFlag = process.env.STRIPE_MOCK_CLIENT === "true";
    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    const tolerance = resolveStripeWebhookTolerance(
      process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS,
    );

    if (isProd) {
      if (mockFlag) {
        throw new Error(
          "STRIPE_MOCK_CLIENT must not be true in production environment",
        );
      }
      if (!secretKey || secretKey.startsWith("sk_test_placeholder")) {
        throw new Error(
          "STRIPE_SECRET_KEY is required and must not be a placeholder in production",
        );
      }
      if (!webhookSecret || webhookSecret.startsWith("whsec_placeholder")) {
        throw new Error(
          "STRIPE_WEBHOOK_SECRET is required and must not be a placeholder in production",
        );
      }
      return {
        isMock: false,
        secretKey,
        webhookSecret,
        webhookToleranceSeconds: tolerance,
      };
    }

    // Non-production environment
    const isMock =
      mockFlag || !secretKey || secretKey.startsWith("sk_test_placeholder");

    return {
      isMock,
      secretKey: secretKey || "sk_test_dummy_key",
      webhookSecret: webhookSecret || "whsec_dummy_key",
      webhookToleranceSeconds: tolerance,
    };
  }

  private initStripe() {
    const config = this.resolveConfig();
    if (!config.isMock && config.secretKey) {
      this.stripeClient = new Stripe(config.secretKey, {
        apiVersion: "2025-02-24.acacia" as any,
      });
    } else if (config.isMock && config.secretKey) {
      this.stripeClient = new Stripe(config.secretKey, {
        apiVersion: "2025-02-24.acacia" as any,
      });
    }
  }

  registerMockSession(session: MockStripeSession) {
    this.mockSessions.set(session.sessionId, session);
  }

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
    const config = this.resolveConfig();

    if (config.isMock) {
      this.logger.log(
        `Creating simulated Stripe checkout session for payment ${payment.id} (MOCK_MODE)`,
      );
      const sessionId = `cs_test_${payment.id}`;
      const sessionUrl = `https://checkout.stripe.com/c/pay/${sessionId}`;
      const mockSession: MockStripeSession = {
        sessionId,
        sessionUrl,
        orderId: order.id,
        paymentId: payment.id,
        amount: payment.amount,
        currency: payment.currency.toUpperCase(),
        status: PaymentStatus.SUCCEEDED,
      };
      this.mockSessions.set(sessionId, mockSession);

      return {
        sessionId,
        sessionUrl,
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
      throw new BadGatewayException("Upstream payment provider failure");
    }
  }

  async getPaymentSession(
    providerReference: string,
  ): Promise<NormalizedPaymentSession | null> {
    const config = this.resolveConfig();
    if (config.isMock) {
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

    if (!this.stripeClient) {
      return null;
    }

    try {
      const session =
        await this.stripeClient.checkout.sessions.retrieve(providerReference);
      return {
        sessionId: session.id,
        sessionUrl: session.url || "",
        providerReference: session.id,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to retrieve Stripe session ${providerReference}: ${err.message}`,
      );
      return null;
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

    const config = this.resolveConfig();
    const webhookSecret = config.webhookSecret;
    if (!webhookSecret || webhookSecret.trim() === "") {
      throw new ForbiddenException("STRIPE_WEBHOOK_SECRET is not configured");
    }

    if (!this.stripeClient) {
      throw new ForbiddenException("Stripe client is not initialized");
    }

    let event: Stripe.Event;
    try {
      event = this.stripeClient.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret,
        config.webhookToleranceSeconds,
      );
    } catch (err: any) {
      this.logger.warn(
        `Stripe webhook signature verification failed: ${err.message}`,
      );
      throw new BadRequestException("Invalid webhook signature");
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

    if (event.type === "checkout.session.completed") {
      if (dataObject.payment_status === "paid") {
        eventType = "payment.succeeded";
        orderId =
          dataObject.client_reference_id ||
          dataObject.metadata?.orderId ||
          "";
        paymentId = dataObject.metadata?.paymentId || "";
        amount = dataObject.amount_total ?? 0;
        currency = (dataObject.currency || "").toUpperCase();
        providerReference = dataObject.id;
      } else {
        // Unpaid or pending async
        eventType = "ignored";
      }
    } else if (event.type === "checkout.session.async_payment_succeeded") {
      eventType = "payment.succeeded";
      orderId =
        dataObject.client_reference_id ||
        dataObject.metadata?.orderId ||
        "";
      paymentId = dataObject.metadata?.paymentId || "";
      amount = dataObject.amount_total ?? 0;
      currency = (dataObject.currency || "").toUpperCase();
      providerReference = dataObject.id;
    } else if (event.type === "checkout.session.async_payment_failed") {
      eventType = "payment.failed";
      orderId =
        dataObject.client_reference_id ||
        dataObject.metadata?.orderId ||
        "";
      paymentId = dataObject.metadata?.paymentId || "";
      amount = dataObject.amount_total ?? 0;
      currency = (dataObject.currency || "").toUpperCase();
      providerReference = dataObject.id;
    } else if (event.type === "checkout.session.expired") {
      eventType = "payment.cancelled";
      orderId =
        dataObject.client_reference_id ||
        dataObject.metadata?.orderId ||
        "";
      paymentId = dataObject.metadata?.paymentId || "";
      amount = dataObject.amount_total ?? 0;
      currency = (dataObject.currency || "").toUpperCase();
      providerReference = dataObject.id;
    } else if (event.type.startsWith("payment_intent.")) {
      // Option 1: Strictly ignore payment_intent events
      eventType = "ignored";
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
    const config = this.resolveConfig();
    if (config.isMock) {
      const mock = this.mockSessions.get(providerReference);
      if (!mock) {
        return null;
      }
      return {
        providerReference: mock.sessionId,
        status: mock.status,
        amount: mock.amount,
        currency: mock.currency,
        externalEventId: `reconcile_${mock.sessionId}`,
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
