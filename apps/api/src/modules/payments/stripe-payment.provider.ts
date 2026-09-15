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
  returnBaseUrl: string;
  /**
   * Authoritative money-mode binding. Production must only ever accept
   * `livemode: true` provider evidence (real Stripe events/sessions); any
   * other environment expects `livemode: false`. Mock mode is exempt since
   * it never touches the real Stripe network and is itself forbidden in
   * production by the isMock/production checks below.
   */
  expectedLivemode: boolean;
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

  private resolveReturnBaseUrl(): string {
    const isProd = process.env.NODE_ENV === "production";
    const configured = process.env.PAYMENT_RETURN_BASE_URL?.trim();

    if (isProd) {
      if (!configured) {
        throw new Error(
          "PAYMENT_RETURN_BASE_URL is required in production for Stripe Checkout redirects",
        );
      }
      let parsed: URL;
      try {
        parsed = new URL(configured);
      } catch {
        throw new Error("PAYMENT_RETURN_BASE_URL must be a valid absolute URL");
      }
      if (parsed.protocol !== "https:") {
        throw new Error("PAYMENT_RETURN_BASE_URL must use HTTPS in production");
      }
      const host = parsed.hostname.toLowerCase();
      if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
        throw new Error(
          "PAYMENT_RETURN_BASE_URL must not point to localhost in production",
        );
      }
      return parsed.origin;
    }

    const fallback =
      configured ||
      process.env.PORTAL_URL?.trim() ||
      process.env.FRONTEND_URL?.trim() ||
      "http://localhost:3000";
    try {
      return new URL(fallback).origin;
    } catch {
      throw new Error("PAYMENT_RETURN_BASE_URL must be a valid absolute URL");
    }
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
      if (!secretKey.startsWith("sk_live_")) {
        throw new Error(
          "STRIPE_SECRET_KEY must be a live Stripe secret key (sk_live_) in production; test-mode keys are not permitted to process real money",
        );
      }
      if (!webhookSecret || webhookSecret.startsWith("whsec_placeholder")) {
        throw new Error(
          "STRIPE_WEBHOOK_SECRET is required and must not be a placeholder in production",
        );
      }
      const returnBaseUrl = this.resolveReturnBaseUrl();
      return {
        isMock: false,
        secretKey,
        webhookSecret,
        webhookToleranceSeconds: tolerance,
        returnBaseUrl,
        expectedLivemode: true,
      };
    }

    const returnBaseUrl = this.resolveReturnBaseUrl();
    const isMock =
      mockFlag || !secretKey || secretKey.startsWith("sk_test_placeholder");

    return {
      isMock,
      secretKey: secretKey || "sk_test_dummy_key",
      webhookSecret: webhookSecret || "whsec_dummy_key",
      webhookToleranceSeconds: tolerance,
      returnBaseUrl,
      expectedLivemode: false,
    };
  }

  private initStripe() {
    const config = this.resolveConfig();
    if (config.secretKey) {
      this.stripeClient = new Stripe(config.secretKey, {
        apiVersion: "2025-02-24.acacia" as any,
      });
    }
  }

  private resolveReturnUrl(
    supplied: string | undefined,
    fallbackPath: string,
    baseUrl: string,
  ): string {
    if (!supplied) {
      return new URL(fallbackPath, `${baseUrl}/`).toString();
    }
    if (supplied.startsWith("/") && !supplied.startsWith("//")) {
      return new URL(supplied, `${baseUrl}/`).toString();
    }
    return new URL(supplied).toString();
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
      const resolvedSuccessUrl = this.resolveReturnUrl(
        successUrl,
        `/orders/${order.id}?session_id={CHECKOUT_SESSION_ID}&status=success`,
        config.returnBaseUrl,
      );
      const resolvedCancelUrl = this.resolveReturnUrl(
        cancelUrl,
        `/orders/${order.id}?status=cancelled`,
        config.returnBaseUrl,
      );

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
          success_url: resolvedSuccessUrl,
          cancel_url: resolvedCancelUrl,
        },
        {
          idempotencyKey: `payment-session-${payment.id}`,
        },
      );

      if (session.livemode !== config.expectedLivemode) {
        this.logger.error(
          `Stripe Checkout Session livemode mismatch for order ${order.id}: expected livemode=${config.expectedLivemode}, received livemode=${session.livemode}`,
        );
        throw new Error("Stripe Checkout Session environment mode does not match configured payment mode");
      }

      if (!session.url) {
        throw new Error("Stripe Checkout Session did not return a session URL");
      }

      return {
        sessionId: session.id,
        sessionUrl: session.url,
        providerReference: session.id,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to create Stripe Checkout Session for order ${order.id}: ${err.message}${err.code ? ` [code=${err.code}]` : ""}${err.type ? ` [type=${err.type}]` : ""}`,
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
      if (!mock?.sessionUrl) return null;
      return {
        sessionId: mock.sessionId,
        sessionUrl: mock.sessionUrl,
        providerReference: mock.sessionId,
      };
    }

    if (!this.stripeClient) return null;

    try {
      const session =
        await this.stripeClient.checkout.sessions.retrieve(providerReference);
      if (session.livemode !== config.expectedLivemode) {
        this.logger.warn(
          `Stripe session livemode mismatch on retrieval for ${providerReference}: expected livemode=${config.expectedLivemode}, received livemode=${session.livemode}`,
        );
        return null;
      }
      if (!session.url) return null;
      return {
        sessionId: session.id,
        sessionUrl: session.url,
        providerReference: session.id,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to retrieve Stripe session ${providerReference}: ${err.message}${err.code ? ` [code=${err.code}]` : ""}${err.type ? ` [type=${err.type}]` : ""}`,
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
    if (!webhookSecret?.trim()) {
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

    if (!config.isMock && event.livemode !== config.expectedLivemode) {
      this.logger.warn(
        `Stripe webhook livemode mismatch (rejected before business processing): expected livemode=${config.expectedLivemode}, received livemode=${event.livemode}, eventId=${event.id}`,
      );
      throw new BadRequestException(
        "Webhook event environment does not match configured payment mode",
      );
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
          dataObject.client_reference_id || dataObject.metadata?.orderId || "";
        paymentId = dataObject.metadata?.paymentId || "";
        amount = dataObject.amount_total ?? 0;
        currency = (dataObject.currency || "").toUpperCase();
        providerReference = dataObject.id;
      }
    } else if (event.type === "checkout.session.async_payment_succeeded") {
      eventType = "payment.succeeded";
      orderId =
        dataObject.client_reference_id || dataObject.metadata?.orderId || "";
      paymentId = dataObject.metadata?.paymentId || "";
      amount = dataObject.amount_total ?? 0;
      currency = (dataObject.currency || "").toUpperCase();
      providerReference = dataObject.id;
    } else if (event.type === "checkout.session.async_payment_failed") {
      eventType = "payment.failed";
      orderId =
        dataObject.client_reference_id || dataObject.metadata?.orderId || "";
      paymentId = dataObject.metadata?.paymentId || "";
      amount = dataObject.amount_total ?? 0;
      currency = (dataObject.currency || "").toUpperCase();
      providerReference = dataObject.id;
    } else if (event.type === "checkout.session.expired") {
      eventType = "payment.cancelled";
      orderId =
        dataObject.client_reference_id || dataObject.metadata?.orderId || "";
      paymentId = dataObject.metadata?.paymentId || "";
      amount = dataObject.amount_total ?? 0;
      currency = (dataObject.currency || "").toUpperCase();
      providerReference = dataObject.id;
    } else if (event.type.startsWith("payment_intent.")) {
      eventType = "ignored";
    }

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
      if (!mock) return null;
      return {
        providerReference: mock.sessionId,
        status: mock.status,
        amount: mock.amount,
        currency: mock.currency,
        externalEventId: `reconcile_${mock.sessionId}`,
      };
    }
    if (!this.stripeClient || !providerReference.startsWith("cs_")) {
      return null;
    }

    try {
      const session =
        await this.stripeClient.checkout.sessions.retrieve(providerReference);

      if (session.livemode !== config.expectedLivemode) {
        this.logger.warn(
          `Stripe session livemode mismatch during reconciliation for ${providerReference}: expected livemode=${config.expectedLivemode}, received livemode=${session.livemode}`,
        );
        return null;
      }

      let status: PaymentStatus = PaymentStatus.PENDING;
      if (session.payment_status === "paid") {
        status = PaymentStatus.SUCCEEDED;
      } else if (session.status === "expired") {
        status = PaymentStatus.CANCELLED;
      }

      return {
        providerReference,
        status,
        amount: session.amount_total ?? 0,
        currency: (session.currency || "").toUpperCase(),
        externalEventId: `reconcile_${session.id}_${session.payment_status}_${session.status}`,
      };
    } catch (err: any) {
      this.logger.error(
        `Failed to query Stripe status for reference ${providerReference}: ${err.message}${err.code ? ` [code=${err.code}]` : ""}${err.type ? ` [type=${err.type}]` : ""}`,
      );
      return null;
    }
  }
}
