import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";

jest.mock("@nexus/database", () => {
  const actual = jest.requireActual("@nexus/database");
  return {
    ...actual,
    prisma: { payment: { findFirst: jest.fn() } },
  };
});

import { prisma } from "@nexus/database";
import { SepayPaymentProvider } from "./sepay-payment.provider";
import { StripePaymentProvider } from "./stripe-payment.provider";

const findFirst = prisma.payment.findFirst as jest.Mock;

const WEBHOOK_KEY = "sepay_unit_test_webhook_key_0123456789";
const PAYMENT_ID = "3f2a9c1e-7b4d-4e8f-9a01-23456789abcd";
const CODE = "NXS3F2A9C1E7B4D";

function configure(env: Record<string, string | undefined> = {}) {
  process.env.SEPAY_BANK_CODE = "MBBank";
  process.env.SEPAY_BANK_ACCOUNT = "0123456789";
  process.env.SEPAY_ACCOUNT_NAME = "CONG TY NEXUS";
  process.env.SEPAY_WEBHOOK_API_KEY = WEBHOOK_KEY;
  Object.assign(process.env, env);
}

function webhook(body: Record<string, any>, key = WEBHOOK_KEY) {
  return {
    raw: Buffer.from(JSON.stringify(body)),
    headers: { authorization: `Apikey ${key}` },
  };
}

const baseTransfer = {
  id: 92704,
  gateway: "MBBank",
  transactionDate: "2026-10-06 14:02:37",
  accountNumber: "0123456789",
  code: null,
  content: `${CODE} thanh toan don hang`,
  transferType: "in",
  transferAmount: 299000,
  referenceCode: "FT26279123",
};

describe("SepayPaymentProvider", () => {
  const baseEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...baseEnv };
    findFirst.mockReset();
  });

  describe("configuration", () => {
    it("is disabled (not an error) when nothing is configured", () => {
      delete process.env.SEPAY_BANK_CODE;
      delete process.env.SEPAY_BANK_ACCOUNT;
      delete process.env.SEPAY_WEBHOOK_API_KEY;
      const provider = new SepayPaymentProvider();
      expect(provider.isEnabled()).toBe(false);
    });

    it("fails closed at boot when partially configured", () => {
      process.env.SEPAY_BANK_CODE = "MBBank";
      delete process.env.SEPAY_BANK_ACCOUNT;
      delete process.env.SEPAY_WEBHOOK_API_KEY;
      expect(() => new SepayPaymentProvider()).toThrow(/partially configured/);
    });

    it("requires a long webhook key in production", () => {
      configure({ NODE_ENV: "production", SEPAY_WEBHOOK_API_KEY: "short" });
      expect(() => new SepayPaymentProvider()).toThrow(/at least 24/);
    });
  });

  describe("createPaymentSession", () => {
    it("issues a deterministic transfer code and VietQR bound to the amount", async () => {
      configure();
      const provider = new SepayPaymentProvider();
      const session = await provider.createPaymentSession({
        order: { id: "o1" } as any,
        payment: { id: PAYMENT_ID, amount: 299000, currency: "VND" } as any,
      });
      expect(session.providerReference).toBe(CODE);
      expect(session.instructions?.transferContent).toBe(CODE);
      const qr = new URL(session.sessionUrl);
      expect(qr.host).toBe("qr.sepay.vn");
      expect(qr.searchParams.get("amount")).toBe("299000");
      expect(qr.searchParams.get("des")).toBe(CODE);
      expect(qr.searchParams.get("acc")).toBe("0123456789");
    });

    it("rejects non-VND orders", async () => {
      configure();
      const provider = new SepayPaymentProvider();
      await expect(
        provider.createPaymentSession({
          order: {} as any,
          payment: { id: PAYMENT_ID, amount: 1200, currency: "USD" } as any,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("refuses to run when not configured", async () => {
      delete process.env.SEPAY_BANK_CODE;
      delete process.env.SEPAY_BANK_ACCOUNT;
      delete process.env.SEPAY_WEBHOOK_API_KEY;
      const provider = new SepayPaymentProvider();
      await expect(
        provider.createPaymentSession({
          order: {} as any,
          payment: { id: PAYMENT_ID, amount: 1, currency: "VND" } as any,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("verifyWebhook", () => {
    beforeEach(() => configure());

    it("rejects a wrong API key before touching the database", async () => {
      const provider = new SepayPaymentProvider();
      const { raw, headers } = webhook(baseTransfer, "wrong-key");
      await expect(provider.verifyWebhook(raw, headers)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(findFirst).not.toHaveBeenCalled();
    });

    it("rejects a missing Authorization header", async () => {
      const provider = new SepayPaymentProvider();
      await expect(
        provider.verifyWebhook(Buffer.from(JSON.stringify(baseTransfer)), {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("emits payment.succeeded for an exact matching incoming transfer", async () => {
      findFirst.mockResolvedValue({
        id: PAYMENT_ID,
        orderId: "order-1",
        amount: 299000,
      });
      const provider = new SepayPaymentProvider();
      const { raw, headers } = webhook(baseTransfer);
      const event = await provider.verifyWebhook(raw, headers);
      expect(event.eventType).toBe("payment.succeeded");
      expect(event.externalEventId).toBe("sepay_92704");
      expect(event.providerReference).toBe(CODE);
      expect(event.paymentId).toBe(PAYMENT_ID);
      expect(event.amount).toBe(299000);
      expect(event.currency).toBe("VND");
      expect(event.rawPayloadHash).toMatch(/^[a-f0-9]{64}$/);
      expect(findFirst).toHaveBeenCalledWith({
        where: { provider: "sepay", providerReference: CODE },
      });
    });

    it("matches codes split by bank-inserted spaces", async () => {
      findFirst.mockResolvedValue({ id: PAYMENT_ID, orderId: "o", amount: 299000 });
      const provider = new SepayPaymentProvider();
      const { raw, headers } = webhook({
        ...baseTransfer,
        content: "MBVCB.123 NXS3F2A9C 1E7B4D CT tu 0123",
      });
      const event = await provider.verifyWebhook(raw, headers);
      expect(event.eventType).toBe("payment.succeeded");
    });

    it("ignores under/over-payments for manual review (never auto-PAID)", async () => {
      findFirst.mockResolvedValue({ id: PAYMENT_ID, orderId: "o", amount: 299000 });
      const provider = new SepayPaymentProvider();
      const { raw, headers } = webhook({ ...baseTransfer, transferAmount: 290000 });
      const event = await provider.verifyWebhook(raw, headers);
      expect(event.eventType).toBe("ignored");
    });

    it("ignores outgoing transfers, foreign accounts and unknown codes", async () => {
      const provider = new SepayPaymentProvider();
      for (const body of [
        { ...baseTransfer, transferType: "out" },
        { ...baseTransfer, accountNumber: "9999999999" },
        { ...baseTransfer, content: "chuyen tien khong ma" },
      ]) {
        const { raw, headers } = webhook(body);
        expect((await provider.verifyWebhook(raw, headers)).eventType).toBe("ignored");
      }
      findFirst.mockResolvedValue(null);
      const { raw, headers } = webhook(baseTransfer);
      expect((await provider.verifyWebhook(raw, headers)).eventType).toBe("ignored");
    });

    it("rejects malformed JSON and missing transaction ids", async () => {
      const provider = new SepayPaymentProvider();
      await expect(
        provider.verifyWebhook(Buffer.from("not-json"), {
          authorization: `Apikey ${WEBHOOK_KEY}`,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      const { raw, headers } = webhook({ ...baseTransfer, id: undefined });
      await expect(provider.verifyWebhook(raw, headers)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});

describe("StripePaymentProvider — optional in production", () => {
  const baseEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...baseEnv };
  });

  it("boots disabled when Stripe is intentionally unconfigured (SePay-only)", () => {
    process.env.NODE_ENV = "production";
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_MOCK_CLIENT;
    const provider = new StripePaymentProvider();
    expect(provider.isEnabled()).toBe(false);
  });

  it("still fails closed on partial production configuration", () => {
    process.env.NODE_ENV = "production";
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_MOCK_CLIENT;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_only_half_configured";
    expect(() => new StripePaymentProvider()).toThrow(/STRIPE_SECRET_KEY is required/);
  });
});
