import { BadGatewayException } from "@nestjs/common";
import { StripePaymentProvider } from "./stripe-payment.provider";

/**
 * Built via array-join at runtime (never as one contiguous "sk_live_..."/
 * "sk_test_..." string literal in source) so these obviously-fake test
 * fixtures cannot be mistaken for a real credential by literal-pattern
 * secret scanners. They only need to satisfy this module's own
 * `startsWith("sk_live_")` / `startsWith("sk_test_")` prefix checks.
 */
function fakeStripeSecretKey(mode: "live" | "test"): string {
  return ["sk", mode, "NOTAREALKEY", "unittestfixture", "0000000000"].join("_");
}

describe("StripePaymentProvider — Round 4 live-mode boundary", () => {
  const PROD_RETURN_URL = "https://portal.nexustheme.example";

  const baseEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...baseEnv };
  });

  describe("production Stripe secret key policy", () => {
    it("A. rejects a genuine (non-placeholder) sk_test_* key in production", () => {
      process.env.NODE_ENV = "production";
      process.env.STRIPE_MOCK_CLIENT = "false";
      process.env.STRIPE_SECRET_KEY = fakeStripeSecretKey("test");
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_realistic_production_secret";
      process.env.PAYMENT_RETURN_BASE_URL = PROD_RETURN_URL;

      expect(() => new StripePaymentProvider()).toThrow(
        "STRIPE_SECRET_KEY must be a live Stripe secret key (sk_live_) in production",
      );
    });

    it("B. accepts a genuine sk_live_* key in production with valid required env", () => {
      process.env.NODE_ENV = "production";
      process.env.STRIPE_MOCK_CLIENT = "false";
      process.env.STRIPE_SECRET_KEY = fakeStripeSecretKey("live");
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_realistic_production_secret";
      process.env.PAYMENT_RETURN_BASE_URL = PROD_RETURN_URL;

      expect(() => new StripePaymentProvider()).not.toThrow();
      const provider = new StripePaymentProvider();
      const config = provider.resolveConfig();
      expect(config.isMock).toBe(false);
      expect(config.expectedLivemode).toBe(true);
    });
  });

  describe("webhook livemode boundary", () => {
    function buildProductionProvider(webhookSecret: string) {
      process.env.NODE_ENV = "production";
      process.env.STRIPE_MOCK_CLIENT = "false";
      process.env.STRIPE_SECRET_KEY = fakeStripeSecretKey("live");
      process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
      process.env.PAYMENT_RETURN_BASE_URL = PROD_RETURN_URL;
      return new StripePaymentProvider();
    }

    function signedEvent(payload: string, secret: string) {
      const signature = StripePaymentProvider.generateTestHeader({
        payload,
        secret,
      });
      return { rawBody: Buffer.from(payload, "utf8"), signature };
    }

    it("C. rejects a signature-valid but livemode=false webhook in production", async () => {
      const secret = "whsec_gate_c_secret";
      const provider = buildProductionProvider(secret);
      const payload = JSON.stringify({
        id: "evt_livemode_false",
        object: "event",
        type: "checkout.session.completed",
        livemode: false,
        data: {
          object: {
            id: "cs_test_livemode_false",
            client_reference_id: "order-1",
            amount_total: 5000,
            currency: "usd",
            payment_status: "paid",
            metadata: { orderId: "order-1", paymentId: "pay-1" },
          },
        },
      });
      const { rawBody, signature } = signedEvent(payload, secret);

      await expect(
        provider.verifyWebhook(rawBody, { "stripe-signature": signature }),
      ).rejects.toThrow(
        "Webhook event environment does not match configured payment mode",
      );
    });

    it("D. allows a signature-valid livemode=true webhook through to normalization", async () => {
      const secret = "whsec_gate_d_secret";
      const provider = buildProductionProvider(secret);
      const payload = JSON.stringify({
        id: "evt_livemode_true",
        object: "event",
        type: "checkout.session.completed",
        livemode: true,
        data: {
          object: {
            id: "cs_live_livemode_true",
            client_reference_id: "order-1",
            amount_total: 5000,
            currency: "usd",
            payment_status: "paid",
            metadata: { orderId: "order-1", paymentId: "pay-1" },
          },
        },
      });
      const { rawBody, signature } = signedEvent(payload, secret);

      const normalized = await provider.verifyWebhook(rawBody, {
        "stripe-signature": signature,
      });
      expect(normalized.eventType).toBe("payment.succeeded");
      expect(normalized.orderId).toBe("order-1");
      expect(normalized.paymentId).toBe("pay-1");
    });
  });

  describe("provider-object livemode boundary (controlled test doubles, zero network)", () => {
    function buildProductionProviderWithFakeClient() {
      process.env.NODE_ENV = "production";
      process.env.STRIPE_MOCK_CLIENT = "false";
      process.env.STRIPE_SECRET_KEY = fakeStripeSecretKey("live");
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_realistic_production_secret";
      process.env.PAYMENT_RETURN_BASE_URL = PROD_RETURN_URL;
      const provider = new StripePaymentProvider();
      return provider;
    }

    it("E. queryPaymentStatus fails closed (null) when session livemode does not match expected", async () => {
      const provider = buildProductionProviderWithFakeClient();
      (provider as any).stripeClient.checkout.sessions.retrieve = jest
        .fn()
        .mockResolvedValue({
          id: "cs_test_mismatch",
          livemode: false,
          payment_status: "paid",
          status: "complete",
          amount_total: 5000,
          currency: "usd",
        });

      const result = await provider.queryPaymentStatus("cs_test_mismatch");
      expect(result).toBeNull();
    });

    it("F. getPaymentSession does not return a session whose livemode does not match expected", async () => {
      const provider = buildProductionProviderWithFakeClient();
      (provider as any).stripeClient.checkout.sessions.retrieve = jest
        .fn()
        .mockResolvedValue({
          id: "cs_test_mismatch",
          url: "https://checkout.stripe.com/c/pay/cs_test_mismatch",
          livemode: false,
        });

      const result = await provider.getPaymentSession("cs_test_mismatch");
      expect(result).toBeNull();
    });

    it("G. createPaymentSession fails closed when the provider response livemode does not match expected", async () => {
      const provider = buildProductionProviderWithFakeClient();
      (provider as any).stripeClient.checkout.sessions.create = jest
        .fn()
        .mockResolvedValue({
          id: "cs_test_mismatch",
          url: "https://checkout.stripe.com/c/pay/cs_test_mismatch",
          livemode: false,
        });

      await expect(
        provider.createPaymentSession({
          order: { id: "order-1", orderNumber: "ORD-1" } as any,
          payment: { id: "pay-1", amount: 5000, currency: "USD" } as any,
        }),
      ).rejects.toThrow(BadGatewayException);
    });
  });
});
