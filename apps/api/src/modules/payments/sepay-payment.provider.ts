import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import * as crypto from "crypto";
import { prisma, Order, Payment, PaymentStatus } from "@nexus/database";
import {
  PaymentProviderAdapter,
  NormalizedPaymentSession,
  NormalizedPaymentEvent,
  NormalizedPaymentStatus,
  BankTransferInstructions,
} from "./payment-provider.interface";

/**
 * SePay (https://sepay.vn) — VietQR bank transfer reconciliation.
 *
 * Flow:
 *   1. createPaymentSession() issues a unique transfer code (providerReference)
 *      and a VietQR image bound to the exact order amount.
 *   2. The customer transfers money; SePay watches the bank account and POSTs
 *      a webhook with header `Authorization: Apikey <SEPAY_WEBHOOK_API_KEY>`.
 *   3. verifyWebhook() authenticates the API key (constant-time), matches the
 *      transfer code back to exactly one PENDING payment and emits normalized
 *      evidence. Amount/currency/reference binding is re-checked by the single
 *      authoritative transition in PaymentsService.
 *
 * Browser evidence (the QR page, a "Tôi đã chuyển khoản" click) is never
 * authoritative; only the authenticated webhook or an API reconciliation can
 * move a payment to SUCCEEDED.
 */
export interface SepayConfig {
  enabled: boolean;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  webhookApiKey: string;
  apiToken?: string;
  codePrefix: string;
  apiBaseUrl: string;
}

export interface SepayWebhookPayload {
  id: number | string;
  gateway?: string;
  transactionDate?: string;
  accountNumber?: string;
  subAccount?: string | null;
  code?: string | null;
  content?: string;
  transferType?: "in" | "out";
  transferAmount?: number;
  accumulated?: number;
  referenceCode?: string;
  description?: string;
}

const MIN_WEBHOOK_KEY_LENGTH = 24;

@Injectable()
export class SepayPaymentProvider implements PaymentProviderAdapter {
  readonly providerName = "sepay";
  private readonly logger = new Logger(SepayPaymentProvider.name);

  constructor() {
    // Fail closed at boot if SePay is partially configured in production.
    this.resolveConfig();
  }

  resolveConfig(): SepayConfig {
    const isProd = process.env.NODE_ENV === "production";
    const bankCode = process.env.SEPAY_BANK_CODE?.trim() || "";
    const accountNumber = process.env.SEPAY_BANK_ACCOUNT?.trim() || "";
    const accountName = process.env.SEPAY_ACCOUNT_NAME?.trim() || "";
    const webhookApiKey = process.env.SEPAY_WEBHOOK_API_KEY?.trim() || "";
    const apiToken = process.env.SEPAY_API_TOKEN?.trim() || undefined;
    const codePrefix = (process.env.SEPAY_PAYMENT_CODE_PREFIX?.trim() || "NXS")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    const apiBaseUrl =
      process.env.SEPAY_API_BASE_URL?.trim() || "https://my.sepay.vn/userapi";

    const anyConfigured = Boolean(bankCode || accountNumber || webhookApiKey);
    const fullyConfigured = Boolean(bankCode && accountNumber && webhookApiKey);

    if (anyConfigured && !fullyConfigured) {
      throw new Error(
        "SePay is partially configured: SEPAY_BANK_CODE, SEPAY_BANK_ACCOUNT and SEPAY_WEBHOOK_API_KEY are all required",
      );
    }
    if (fullyConfigured && isProd && webhookApiKey.length < MIN_WEBHOOK_KEY_LENGTH) {
      throw new Error(
        `SEPAY_WEBHOOK_API_KEY must be at least ${MIN_WEBHOOK_KEY_LENGTH} characters in production`,
      );
    }
    if (codePrefix.length < 2 || codePrefix.length > 6) {
      throw new Error("SEPAY_PAYMENT_CODE_PREFIX must be 2-6 alphanumeric characters");
    }

    return {
      enabled: fullyConfigured,
      bankCode,
      accountNumber,
      accountName,
      webhookApiKey,
      apiToken,
      codePrefix,
      apiBaseUrl,
    };
  }

  isEnabled(): boolean {
    return this.resolveConfig().enabled;
  }

  private requireConfig(): SepayConfig {
    const config = this.resolveConfig();
    if (!config.enabled) {
      throw new ForbiddenException("SePay payment provider is not configured");
    }
    return config;
  }

  /** Deterministic transfer code derived from the payment id (uuid). */
  buildTransferCode(paymentId: string, prefix: string): string {
    const compact = paymentId.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
    return `${prefix}${compact.slice(0, 12)}`;
  }

  private buildInstructions(
    config: SepayConfig,
    code: string,
    amount: number,
  ): BankTransferInstructions {
    const qr = new URL("https://qr.sepay.vn/img");
    qr.searchParams.set("acc", config.accountNumber);
    qr.searchParams.set("bank", config.bankCode);
    qr.searchParams.set("amount", String(amount));
    qr.searchParams.set("des", code);
    qr.searchParams.set("template", "compact");
    return {
      bankCode: config.bankCode,
      accountNumber: config.accountNumber,
      accountName: config.accountName,
      amount,
      currency: "VND",
      transferContent: code,
      qrImageUrl: qr.toString(),
    };
  }

  async createPaymentSession(params: {
    order: Order;
    payment: Payment;
  }): Promise<NormalizedPaymentSession> {
    const config = this.requireConfig();
    const { payment } = params;

    if (payment.currency.toUpperCase() !== "VND") {
      throw new BadRequestException(
        "SePay chỉ hỗ trợ đơn hàng thanh toán bằng VND",
      );
    }
    if (!Number.isInteger(payment.amount) || payment.amount <= 0) {
      throw new BadRequestException("Invalid payment amount for bank transfer");
    }

    const code = this.buildTransferCode(payment.id, config.codePrefix);
    const instructions = this.buildInstructions(config, code, payment.amount);
    return {
      sessionId: code,
      sessionUrl: instructions.qrImageUrl,
      providerReference: code,
      instructions,
    };
  }

  async getPaymentSession(
    providerReference: string,
  ): Promise<NormalizedPaymentSession | null> {
    const config = this.requireConfig();
    const payment = await prisma.payment.findFirst({
      where: { provider: this.providerName, providerReference },
    });
    if (!payment || payment.status !== PaymentStatus.PENDING) return null;
    const instructions = this.buildInstructions(
      config,
      providerReference,
      payment.amount,
    );
    return {
      sessionId: providerReference,
      sessionUrl: instructions.qrImageUrl,
      providerReference,
      instructions,
    };
  }

  private authenticate(
    headers: Record<string, string | string[] | undefined>,
    config: SepayConfig,
  ): void {
    const raw = headers["authorization"] ?? headers["Authorization"];
    const header = Array.isArray(raw) ? raw[0] : raw;
    const match = /^Apikey\s+(.+)$/i.exec((header || "").trim());
    const supplied = Buffer.from(match?.[1]?.trim() || "", "utf8");
    const expected = Buffer.from(config.webhookApiKey, "utf8");
    if (
      supplied.length !== expected.length ||
      !crypto.timingSafeEqual(supplied, expected)
    ) {
      throw new UnauthorizedException("Invalid SePay webhook credentials");
    }
  }

  /** Extracts our transfer code from SePay's `code` field or free-text content. */
  extractTransferCode(
    payload: Pick<SepayWebhookPayload, "code" | "content" | "description">,
    prefix: string,
  ): string | null {
    const pattern = new RegExp(`${prefix}[A-F0-9]{12}`, "i");
    for (const candidate of [payload.code, payload.content, payload.description]) {
      if (!candidate) continue;
      const found = pattern.exec(String(candidate).replace(/\s+/g, ""));
      if (found) return found[0].toUpperCase();
    }
    return null;
  }

  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<NormalizedPaymentEvent> {
    const config = this.requireConfig();
    this.authenticate(headers, config);

    let payload: SepayWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new BadRequestException("Invalid SePay webhook JSON");
    }
    if (payload?.id === undefined || payload?.id === null || payload.id === "") {
      throw new BadRequestException("SePay webhook is missing transaction id");
    }

    const rawPayloadHash = crypto.createHash("sha256").update(rawBody).digest("hex");
    const externalEventId = `sepay_${payload.id}`;
    const sanitizedPayload = {
      id: payload.id,
      gateway: payload.gateway,
      transactionDate: payload.transactionDate,
      transferType: payload.transferType,
      transferAmount: payload.transferAmount,
      referenceCode: payload.referenceCode,
      code: payload.code,
    };
    const ignored = (reason: string): NormalizedPaymentEvent => {
      this.logger.warn(
        JSON.stringify({ event: "sepay_webhook_ignored", reason, externalEventId }),
      );
      return {
        externalEventId,
        eventType: "ignored",
        orderId: "",
        paymentId: "",
        amount: 0,
        currency: "VND",
        providerReference: "",
        rawPayloadHash,
        sanitizedPayload,
      };
    };

    if (payload.transferType !== "in") return ignored("outgoing_transfer");
    if (
      payload.accountNumber &&
      payload.accountNumber.trim() !== config.accountNumber &&
      payload.subAccount?.trim() !== config.accountNumber
    ) {
      return ignored("account_mismatch");
    }
    const amount = Number(payload.transferAmount);
    if (!Number.isInteger(amount) || amount <= 0) return ignored("invalid_amount");

    const code = this.extractTransferCode(payload, config.codePrefix);
    if (!code) return ignored("no_transfer_code");

    const payment = await prisma.payment.findFirst({
      where: { provider: this.providerName, providerReference: code },
    });
    if (!payment) return ignored("unknown_transfer_code");
    if (payment.amount !== amount) {
      // Under/over-payment needs a human decision; never auto-mark PAID.
      return ignored("amount_mismatch_manual_review");
    }

    return {
      externalEventId,
      eventType: "payment.succeeded",
      orderId: payment.orderId,
      paymentId: payment.id,
      amount,
      currency: "VND",
      providerReference: code,
      rawPayloadHash,
      sanitizedPayload,
    };
  }

  /**
   * Active reconciliation via SePay user API (requires SEPAY_API_TOKEN).
   * Returns null whenever the provider cannot positively confirm a matching
   * incoming transfer, so reconciliation fails safe.
   */
  async queryPaymentStatus(
    providerReference: string,
  ): Promise<NormalizedPaymentStatus | null> {
    const config = this.requireConfig();
    if (!config.apiToken) return null;

    const payment = await prisma.payment.findFirst({
      where: { provider: this.providerName, providerReference },
    });
    if (!payment) return null;

    const url = new URL(`${config.apiBaseUrl}/transactions/list`);
    url.searchParams.set("account_number", config.accountNumber);
    url.searchParams.set("limit", "200");

    let body: any;
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      body = await res.json();
    } catch (err: any) {
      this.logger.warn(`SePay reconciliation query failed: ${err?.message}`);
      return null;
    }

    const transactions: any[] = Array.isArray(body?.transactions)
      ? body.transactions
      : [];
    const hit = transactions.find((tx) => {
      const amountIn = Number(tx?.amount_in);
      const code = this.extractTransferCode(
        { code: tx?.code, content: tx?.transaction_content },
        config.codePrefix,
      );
      return code === providerReference && amountIn === payment.amount;
    });
    if (!hit) return null;

    return {
      providerReference,
      status: PaymentStatus.SUCCEEDED,
      amount: payment.amount,
      currency: "VND",
      externalEventId: `sepay_${hit.id}`,
    };
  }
}
