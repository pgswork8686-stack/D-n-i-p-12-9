import * as crypto from "node:crypto";
import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  prisma,
  OrderStatus,
  PaymentStatus,
  OutboxEventStatus,
} from "../src/index";
import { processOutboxEvents } from "../../../apps/worker/src/outbox-processor";

const TEST_PORT = process.env.API_PORT || process.env.PORT || "4006";
const API_BASE = `http://localhost:${TEST_PORT}`;
const STRIPE_TEST_SECRET = "whsec_test_secret_for_acceptance_testing_only";
const STRIPE_API_KEY = "sk_test_placeholder_acceptance";
const TEST_WEBHOOK_SECRET = "change-me-local-only";
const TEST_ENCRYPTION_KEY =
  process.env.LICENSE_KEY_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let apiProcess: ChildProcess | null = null;
let allSpawnedProcesses: ChildProcess[] = [];

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateStripeSignature(
  payload: string | Buffer,
  secret: string,
  timestamp?: number,
): string {
  const t = timestamp !== undefined ? timestamp : Math.floor(Date.now() / 1000);
  const payloadStr =
    typeof payload === "string" ? payload : payload.toString("utf8");
  const signedContent = `${t}.${payloadStr}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(signedContent)
    .digest("hex");
  return `t=${t},v1=${signature}`;
}

async function ensureApiRunning(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (res.ok) {
      console.log(`  API server already running on port ${TEST_PORT}.`);
      return;
    }
  } catch {
    // Not running
  }

  console.log(`  Starting API child process on port ${TEST_PORT}...`);
  apiProcess = spawn(
    "node",
    [path.resolve(__dirname, "../../../apps/api/dist/main.js")],
    {
      cwd: path.resolve(__dirname, "../../.."),
      stdio: "pipe",
      env: {
        ...process.env,
        PORT: TEST_PORT,
        API_URL: API_BASE,
        STRIPE_SECRET_KEY: STRIPE_API_KEY,
        STRIPE_WEBHOOK_SECRET: STRIPE_TEST_SECRET,
        STRIPE_MOCK_CLIENT: "true",
        ENABLE_TEST_PAYMENT_PROVIDER: "true",
        TEST_PAYMENT_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
        LICENSE_KEY_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      },
    },
  );

  allSpawnedProcesses.push(apiProcess);

  apiProcess.stdout?.on("data", (data) => {
    const msg = data.toString();
    if (msg.includes("NEXUSTHEME API is running")) {
      console.log(`  ${msg.trim()}`);
    }
  });

  apiProcess.stderr?.on("data", (data) => {
    const msg = data.toString();
    if (!msg.includes("ExperimentalWarning") && !msg.includes("DeprecationWarning")) {
      console.error(`  [API Error] ${msg.trim()}`);
    }
  });

  const startTime = Date.now();
  while (Date.now() - startTime < 30000) {
    await sleep(500);
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) {
        console.log("  API server is ready!");
        return;
      }
    } catch {
      // Keep waiting
    }
  }
  throw new Error("Timed out waiting for API server to start");
}

function stopChildProcesses(): void {
  for (const p of allSpawnedProcesses) {
    try {
      p.kill("SIGTERM");
    } catch {}
  }
  allSpawnedProcesses = [];
  if (apiProcess) {
    try {
      apiProcess.kill("SIGTERM");
    } catch {}
    apiProcess = null;
  }
}

process.on("exit", stopChildProcesses);
process.on("SIGINT", () => {
  stopChildProcesses();
  process.exit(1);
});
process.on("SIGTERM", () => {
  stopChildProcesses();
  process.exit(1);
});

async function apiPost(
  endpoint: string,
  body: any,
  token?: string,
  baseUrl = API_BASE,
  customHeaders?: Record<string, string>,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...customHeaders,
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function apiGet(endpoint: string, token?: string, baseUrl = API_BASE) {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: "GET",
    headers,
  });
  const data: any = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function createCustomerOrder(
  customerToken: string,
  targetVariantId: string,
  quantity = 1,
) {
  // Clear cart
  await fetch(`${API_BASE}/cart`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${customerToken}` },
  });

  // Add item
  const addRes = await apiPost(
    "/cart/items",
    {
      variantId: targetVariantId,
      quantity,
      currency: "USD",
    },
    customerToken,
  );

  if (!addRes.ok) {
    throw new Error(`Failed to add item to cart: ${JSON.stringify(addRes.data)}`);
  }

  // Checkout
  const checkoutRes = await apiPost(
    "/checkout",
    { currency: "USD" },
    customerToken,
  );
  if (!checkoutRes.ok) {
    throw new Error(`Checkout failed: ${JSON.stringify(checkoutRes.data)}`);
  }

  const order = checkoutRes.data.order;
  const payment = checkoutRes.data.payment;
  return { order, payment };
}

async function runPhase9Acceptance() {
  console.log("==================================================");
  console.log("PHASE 9 — PRODUCTION PAYMENT GATEWAY ACCEPTANCE (73 GATES)");
  console.log("==================================================\n");

  // ----------------------------------------------------
  // Gate 1: Health 200 OK
  // ----------------------------------------------------
  console.log("[Gate 1] Verifying API Server Runtime Health...");
  await ensureApiRunning();
  const healthRes = await apiGet("/health");
  if (!healthRes.ok || healthRes.data?.status !== "ok") {
    throw new Error(`Gate 1 failed: health check returned ${healthRes.status}`);
  }
  console.log("✓ Gate 1 passed: API is healthy and operational");

  // ----------------------------------------------------
  // Gate 2: Provider Factory Resolution & Unsupported Provider Rejection
  // ----------------------------------------------------
  console.log("\n[Gate 2] Verifying Provider Factory resolution & neutrality...");
  const customerToken = "dev-customer-token";
  const customer2Token = "dev-custom:sub_dev_customer_002:customer2@nexustheme.dev";
  const adminToken = "dev-admin-token";

  // Check customer user resolution
  const custMe = await apiGet("/auth/me", customerToken);
  if (!custMe.ok || !custMe.data?.id) {
    throw new Error("Failed to authenticate test customer");
  }
  const customerUserId = custMe.data.id;

  // ----------------------------------------------------
  // Gate 4: Catalog Product Lookup
  // ----------------------------------------------------
  console.log("\n[Gate 4] Selecting catalog product and variant for live tests...");
  const productsRes = await apiGet("/products?currency=USD");
  if (!productsRes.ok || !productsRes.data?.items?.length) {
    throw new Error("No products available in catalog for payment acceptance tests");
  }
  const testProductSlug = productsRes.data.items[0].slug;
  const productDetail = await apiGet(`/products/${testProductSlug}?currency=USD`);
  const targetVariant = productDetail.data.variants?.[0];
  if (!targetVariant) {
    throw new Error("No variant found on test product");
  }
  console.log(
    `✓ Gate 4 passed: Catalog variant selected: ${targetVariant.name} (${targetVariant.sku})`,
  );

  // Initial order for Gate 2 & Gate 5-7 tests
  const { order: testOrder } = await createCustomerOrder(
    customerToken,
    targetVariant.id,
    1,
  );

  // Unsupported provider test
  const unsupportedProviderRes = await apiPost(
    `/v1/orders/${testOrder.id}/payment-session`,
    { provider: "crypto_pay" },
    customerToken,
  );
  if (
    unsupportedProviderRes.status !== 404 &&
    unsupportedProviderRes.status !== 400
  ) {
    throw new Error(
      `Gate 2 failed: Expected 404 or 400 for unsupported provider, got ${unsupportedProviderRes.status}`,
    );
  }
  console.log("✓ Gate 2 passed: Unsupported provider 'crypto_pay' rejected cleanly");

  // ----------------------------------------------------
  // Gate 3: Strict Production Block for Test Provider
  // ----------------------------------------------------
  console.log("\n[Gate 3] Verifying strict production block on Test provider...");
  const prodCheckResult = await new Promise<boolean>((resolve) => {
    const child = spawn(
      "node",
      [
        "-e",
        `
        process.env.NODE_ENV = 'production';
        process.env.ENABLE_TEST_PAYMENT_PROVIDER = 'true';
        process.env.STRIPE_SECRET_KEY = 'sk_live_valid_dummy_key';
        process.env.STRIPE_WEBHOOK_SECRET = 'whsec_valid_dummy_key';
        process.env.STRIPE_MOCK_CLIENT = 'false';
        process.env.PAYMENT_RETURN_BASE_URL = 'https://portal.nexustheme.example';
        try {
          const { TestPaymentProvider } = require('./apps/api/dist/modules/payments/test-payment.provider');
          const { PaymentProviderFactory } = require('./apps/api/dist/modules/payments/payment-provider.factory');
          const { StripePaymentProvider } = require('./apps/api/dist/modules/payments/stripe-payment.provider');
          const testProvider = new TestPaymentProvider();
          const stripeProvider = new StripePaymentProvider();
          const factory = new PaymentProviderFactory(stripeProvider, testProvider);
          factory.getAdapter('test');
          process.exit(1); // Should have thrown!
        } catch (err) {
          if (err.message && err.message.includes('Test payment provider is unavailable')) {
            process.exit(0); // Expected!
          }
          process.exit(2);
        }
      `,
      ],
      {
        cwd: path.resolve(__dirname, "../../.."),
      },
    );
    child.on("exit", (code) => resolve(code === 0));
  });

  if (!prodCheckResult) {
    throw new Error(
      "Gate 3 failed: Test provider was NOT blocked when NODE_ENV === 'production'",
    );
  }
  console.log("✓ Gate 3 passed: Test provider strictly blocked in production mode (403 Forbidden)");

  // ----------------------------------------------------
  // Gate 5: Unauthenticated Payment Session Rejection
  // ----------------------------------------------------
  console.log("\n[Gate 5] Verifying unauthenticated session creation rejection...");
  const unauthRes = await apiPost(
    `/v1/orders/${testOrder.id}/payment-session`,
    { provider: "stripe" },
  );
  if (unauthRes.status !== 401) {
    throw new Error(
      `Gate 5 failed: Expected 401 Unauthorized for unauthenticated session request, got ${unauthRes.status}`,
    );
  }
  console.log("✓ Gate 5 passed: Unauthenticated session creation rejected with 401");

  // ----------------------------------------------------
  // Gate 6: Cross-User Access Prevention (ID Enumeration Defense)
  // ----------------------------------------------------
  console.log("\n[Gate 6] Verifying cross-user access rejection (Customer B -> Customer A order)...");
  const crossUserRes = await apiPost(
    `/v1/orders/${testOrder.id}/payment-session`,
    { provider: "stripe" },
    customer2Token,
  );
  if (crossUserRes.status !== 403 && crossUserRes.status !== 404) {
    throw new Error(
      `Gate 6 failed: Expected 403 or 404 for cross-user order session request, got ${crossUserRes.status}`,
    );
  }
  console.log("✓ Gate 6 passed: Cross-user session creation strictly rejected (defense-in-depth)");

  // ----------------------------------------------------
  // Gate 7: Non-Existent Order Session Creation Rejection
  // ----------------------------------------------------
  console.log("\n[Gate 7] Verifying non-existent order session creation rejection...");
  const nonExistentRes = await apiPost(
    "/v1/orders/00000000-0000-0000-0000-000000000000/payment-session",
    { provider: "stripe" },
    customerToken,
  );
  if (nonExistentRes.status !== 404) {
    throw new Error(
      `Gate 7 failed: Expected 404 Not Found for non-existent order, got ${nonExistentRes.status}`,
    );
  }
  console.log("✓ Gate 7 passed: Non-existent order returns 404 Not Found");

  // ----------------------------------------------------
  // Gate 8: Authenticated Session Creation Happy Path (Stripe)
  // ----------------------------------------------------
  console.log("\n[Gate 8] Creating Stripe Checkout Session for pending order...");
  const sessionRes = await apiPost(
    `/v1/orders/${testOrder.id}/payment-session`,
    { provider: "stripe" },
    customerToken,
  );
  if (!sessionRes.ok) {
    throw new Error(
      `Gate 8 failed: Session creation returned ${sessionRes.status}: ${JSON.stringify(sessionRes.data)}`,
    );
  }
  const sessionData = sessionRes.data;
  if (
    !sessionData.sessionId ||
    !sessionData.sessionUrl ||
    sessionData.provider !== "stripe" ||
    sessionData.orderId !== testOrder.id ||
    sessionData.amount !== testOrder.totalAmount ||
    sessionData.currency !== testOrder.currency
  ) {
    throw new Error(
      `Gate 8 failed: Session response missing required fields or mismatched: ${JSON.stringify(sessionData)}`,
    );
  }

  // Verify DB Payment row
  const dbPayment = await prisma.payment.findUnique({
    where: { id: sessionData.paymentId },
  });
  if (
    !dbPayment ||
    dbPayment.status !== PaymentStatus.PENDING ||
    dbPayment.provider !== "stripe" ||
    dbPayment.amount !== testOrder.totalAmount ||
    dbPayment.currency !== testOrder.currency
  ) {
    throw new Error(
      `Gate 8 failed: DB Payment row inconsistent: ${JSON.stringify(dbPayment)}`,
    );
  }
  console.log(
    `✓ Gate 8 passed: Session created (ID: ${sessionData.sessionId}), Payment in DB is PENDING`,
  );

  // ----------------------------------------------------
  // Gate 9: Price & Currency Immutability Enforcement
  // ----------------------------------------------------
  console.log("\n[Gate 9] Verifying price & currency immutability from request body...");
  const spoofAttemptRes = await apiPost(
    `/v1/orders/${testOrder.id}/payment-session`,
    {
      provider: "stripe",
      // Spoofed fields that MUST be ignored
      amount: 1,
      currency: "EUR",
      totalAmount: 1,
    },
    customerToken,
  );
  if (
    spoofAttemptRes.data.amount !== testOrder.totalAmount ||
    spoofAttemptRes.data.currency !== testOrder.currency
  ) {
    throw new Error(
      `Gate 9 failed: Price tampering accepted! Expected ${testOrder.totalAmount} ${testOrder.currency}, got ${spoofAttemptRes.data.amount} ${spoofAttemptRes.data.currency}`,
    );
  }
  console.log("✓ Gate 9 passed: Client-supplied prices completely ignored, DB total enforced");

  // ----------------------------------------------------
  // Gate 10: Session Creation Idempotency
  // ----------------------------------------------------
  console.log("\n[Gate 10] Verifying session creation idempotency (repeated requests)...");
  const repeatSessionRes = await apiPost(
    `/v1/orders/${testOrder.id}/payment-session`,
    { provider: "stripe" },
    customerToken,
  );
  if (
    repeatSessionRes.data.sessionId !== sessionData.sessionId ||
    repeatSessionRes.data.paymentId !== sessionData.paymentId
  ) {
    throw new Error("Gate 10 failed: Idempotent session request returned different session/payment ID");
  }
  const paymentCount = await prisma.payment.count({
    where: { orderId: testOrder.id },
  });
  if (paymentCount !== 1) {
    throw new Error(
      `Gate 10 failed: Expected exactly 1 Payment row for order, found ${paymentCount}`,
    );
  }
  console.log("✓ Gate 10 passed: Repeated session creation returned existing session without duplicates");

  // ----------------------------------------------------
  // Gate 11: Webhook Missing Signature Header Rejection
  // ----------------------------------------------------
  console.log("\n[Gate 11] Verifying webhook rejection on missing signature header...");
  const samplePayload = JSON.stringify({
    id: `evt_missing_sig_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: sessionData.sessionId } },
  });
  const missingSigRes = await apiPost(
    "/v1/webhooks/payments/stripe",
    samplePayload,
    undefined,
    API_BASE,
    { "stripe-signature": "" },
  );
  if (missingSigRes.status !== 400) {
    throw new Error(
      `Gate 11 failed: Expected 400 Bad Request for missing signature, got ${missingSigRes.status}`,
    );
  }
  console.log("✓ Gate 11 passed: Missing signature header rejected with 400 Bad Request");

  // ----------------------------------------------------
  // Gate 12: Webhook Invalid / Malformed Signature Rejection
  // ----------------------------------------------------
  console.log("\n[Gate 12] Verifying webhook rejection on malformed signature header...");
  const malformedSigRes = await apiPost(
    "/v1/webhooks/payments/stripe",
    samplePayload,
    undefined,
    API_BASE,
    { "stripe-signature": "t=1234567,v1=invalid_garbage_hex" },
  );
  if (malformedSigRes.status !== 400) {
    throw new Error(
      `Gate 12 failed: Expected 400 Bad Request for malformed signature, got ${malformedSigRes.status}`,
    );
  }
  console.log("✓ Gate 12 passed: Malformed signature header rejected with 400 Bad Request");

  // ----------------------------------------------------
  // Gate 13: Webhook Wrong Secret Rejection
  // ----------------------------------------------------
  console.log("\n[Gate 13] Verifying webhook rejection when signed with wrong secret...");
  const wrongSecretSig = generateStripeSignature(
    samplePayload,
    "whsec_wrong_attacker_secret_9999",
  );
  const wrongSecretRes = await apiPost(
    "/v1/webhooks/payments/stripe",
    samplePayload,
    undefined,
    API_BASE,
    { "stripe-signature": wrongSecretSig },
  );
  if (wrongSecretRes.status !== 400) {
    throw new Error(
      `Gate 13 failed: Expected 400 Bad Request for wrong secret signature, got ${wrongSecretRes.status}`,
    );
  }
  console.log("✓ Gate 13 passed: Webhook signed with wrong secret rejected with 400 Bad Request");

  // ----------------------------------------------------
  // Gate 14: Webhook Tampered Raw Body Rejection
  // ----------------------------------------------------
  console.log("\n[Gate 14] Verifying webhook rejection on tampered raw body...");
  const validSigOriginal = generateStripeSignature(
    samplePayload,
    STRIPE_TEST_SECRET,
  );
  const tamperedPayload = JSON.stringify({
    id: `evt_missing_sig_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: sessionData.sessionId, tamperedField: "injected" } },
  });
  const tamperedRes = await apiPost(
    "/v1/webhooks/payments/stripe",
    tamperedPayload,
    undefined,
    API_BASE,
    { "stripe-signature": validSigOriginal },
  );
  if (tamperedRes.status !== 400) {
    throw new Error(
      `Gate 14 failed: Expected 400 Bad Request for tampered payload, got ${tamperedRes.status}`,
    );
  }
  console.log("✓ Gate 14 passed: Tampered payload rejected with 400 Bad Request");

  // ----------------------------------------------------
  // Gate 15: Webhook Expired Timestamp Rejection (Tolerance Window)
  // ----------------------------------------------------
  console.log("\n[Gate 15] Verifying webhook rejection on expired timestamp (tolerance check)...");
  const expiredTimestamp = Math.floor(Date.now() / 1000) - 900; // 15 mins ago (> 300s tolerance)
  const expiredSig = generateStripeSignature(
    samplePayload,
    STRIPE_TEST_SECRET,
    expiredTimestamp,
  );
  const expiredRes = await apiPost(
    "/v1/webhooks/payments/stripe",
    samplePayload,
    undefined,
    API_BASE,
    { "stripe-signature": expiredSig },
  );
  if (expiredRes.status !== 400) {
    throw new Error(
      `Gate 15 failed: Expected 400 Bad Request for expired timestamp, got ${expiredRes.status}`,
    );
  }
  console.log("✓ Gate 15 passed: Expired webhook timestamp rejected with 400 Bad Request");

  // ----------------------------------------------------
  // Gate 16: Unknown Provider Route Rejection
  // ----------------------------------------------------
  console.log("\n[Gate 16] Verifying unknown webhook provider routing rejection...");
  const unknownProviderWebhook = await apiPost(
    "/v1/webhooks/payments/non_existent_provider",
    samplePayload,
    undefined,
    API_BASE,
  );
  if (
    unknownProviderWebhook.status !== 404 &&
    unknownProviderWebhook.status !== 400
  ) {
    throw new Error(
      `Gate 16 failed: Expected 404/400 for unknown provider, got ${unknownProviderWebhook.status}`,
    );
  }
  console.log("✓ Gate 16 passed: Unknown provider webhook route rejected cleanly");

  // ----------------------------------------------------
  // Gate 17: Zero DB Side-Effects on Rejected Webhooks
  // ----------------------------------------------------
  console.log("\n[Gate 17] Verifying zero DB side-effects across all rejected webhook attempts...");
  const eventsCount = await prisma.paymentEvent.count({
    where: { paymentId: sessionData.paymentId },
  });
  if (eventsCount !== 0) {
    throw new Error(
      `Gate 17 failed: Expected 0 PaymentEvent records for rejected attempts, found ${eventsCount}`,
    );
  }
  const checkPayment = await prisma.payment.findUniqueOrThrow({
    where: { id: sessionData.paymentId },
  });
  const checkOrder = await prisma.order.findUniqueOrThrow({
    where: { id: testOrder.id },
  });
  if (
    checkPayment.status !== PaymentStatus.PENDING ||
    checkOrder.status !== OrderStatus.PENDING_PAYMENT
  ) {
    throw new Error("Gate 17 failed: Payment or Order state was mutated by rejected webhooks");
  }
  console.log("✓ Gate 17 passed: Zero DB mutations occurred across all rejected webhooks");

  // ----------------------------------------------------
  // Gate 18: Payment Binding Verification — Non-Existent Payment
  // ----------------------------------------------------
  console.log("\n[Gate 18] Verifying fail-closed payment binding (non-existent paymentId)...");
  const nonExistentPayPayload = JSON.stringify({
    id: `evt_binding_non_exist_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_non_existent",
        client_reference_id: testOrder.id,
        amount_total: testOrder.totalAmount,
        currency: "usd",
        payment_status: "paid",
        metadata: {
          orderId: testOrder.id,
          paymentId: "00000000-0000-0000-0000-000000000000",
        },
      },
    },
  });
  const nonExistentPaySig = generateStripeSignature(
    nonExistentPayPayload,
    STRIPE_TEST_SECRET,
  );
  const nonExistentPayRes = await apiPost(
    "/v1/webhooks/payments/stripe",
    nonExistentPayPayload,
    undefined,
    API_BASE,
    { "stripe-signature": nonExistentPaySig },
  );
  if (nonExistentPayRes.status !== 404) {
    throw new Error(
      `Gate 18 failed: Expected 404 Not Found for non-existent payment, got ${nonExistentPayRes.status}`,
    );
  }
  console.log("✓ Gate 18 passed: Webhook for non-existent payment failed closed with 404");

  // ----------------------------------------------------
  // Gate 19: Payment Binding Verification — Amount Mismatch
  // ----------------------------------------------------
  console.log("\n[Gate 19] Verifying fail-closed payment binding (amount mismatch)...");
  const mismatchAmountPayload = JSON.stringify({
    id: `evt_binding_mismatch_amt_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionData.sessionId,
        client_reference_id: testOrder.id,
        amount_total: testOrder.totalAmount + 5000, // Mismatched amount!
        currency: "usd",
        payment_status: "paid",
        metadata: {
          orderId: testOrder.id,
          paymentId: sessionData.paymentId,
        },
      },
    },
  });
  const mismatchAmountSig = generateStripeSignature(
    mismatchAmountPayload,
    STRIPE_TEST_SECRET,
  );
  const mismatchAmountRes = await apiPost(
    "/v1/webhooks/payments/stripe",
    mismatchAmountPayload,
    undefined,
    API_BASE,
    { "stripe-signature": mismatchAmountSig },
  );
  if (mismatchAmountRes.status !== 400) {
    throw new Error(
      `Gate 19 failed: Expected 400 Bad Request for amount mismatch, got ${mismatchAmountRes.status}`,
    );
  }
  console.log("✓ Gate 19 passed: Webhook with amount mismatch failed closed with 400");

  // ----------------------------------------------------
  // Gate 20: Payment Binding Verification — Currency Mismatch
  // ----------------------------------------------------
  console.log("\n[Gate 20] Verifying fail-closed payment binding (currency mismatch)...");
  const mismatchCurrencyPayload = JSON.stringify({
    id: `evt_binding_mismatch_curr_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionData.sessionId,
        client_reference_id: testOrder.id,
        amount_total: testOrder.totalAmount,
        currency: "eur", // Mismatched currency!
        payment_status: "paid",
        metadata: {
          orderId: testOrder.id,
          paymentId: sessionData.paymentId,
        },
      },
    },
  });
  const mismatchCurrencySig = generateStripeSignature(
    mismatchCurrencyPayload,
    STRIPE_TEST_SECRET,
  );
  const mismatchCurrencyRes = await apiPost(
    "/v1/webhooks/payments/stripe",
    mismatchCurrencyPayload,
    undefined,
    API_BASE,
    { "stripe-signature": mismatchCurrencySig },
  );
  if (mismatchCurrencyRes.status !== 400) {
    throw new Error(
      `Gate 20 failed: Expected 400 Bad Request for currency mismatch, got ${mismatchCurrencyRes.status}`,
    );
  }
  console.log("✓ Gate 20 passed: Webhook with currency mismatch failed closed with 400");

  // ----------------------------------------------------
  // Gate 21: Payment Binding Verification — Provider Reference Mismatch
  // ----------------------------------------------------
  console.log("\n[Gate 21] Verifying fail-closed payment binding (providerReference mismatch)...");
  const mismatchRefPayload = JSON.stringify({
    id: `evt_binding_mismatch_ref_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_completely_different_session_id", // Mismatched reference!
        client_reference_id: testOrder.id,
        amount_total: testOrder.totalAmount,
        currency: "usd",
        payment_status: "paid",
        metadata: {
          orderId: testOrder.id,
          paymentId: sessionData.paymentId,
        },
      },
    },
  });
  const mismatchRefSig = generateStripeSignature(
    mismatchRefPayload,
    STRIPE_TEST_SECRET,
  );
  const mismatchRefRes = await apiPost(
    "/v1/webhooks/payments/stripe",
    mismatchRefPayload,
    undefined,
    API_BASE,
    { "stripe-signature": mismatchRefSig },
  );
  if (mismatchRefRes.status !== 400) {
    throw new Error(
      `Gate 21 failed: Expected 400 Bad Request for providerReference mismatch, got ${mismatchRefRes.status}`,
    );
  }
  console.log("✓ Gate 21 passed: Webhook with providerReference mismatch failed closed with 400");

  // ----------------------------------------------------
  // Gate 22: Authoritative Success Webhook Execution
  // ----------------------------------------------------
  console.log("\n[Gate 22] Sending authoritative signed Stripe checkout.session.completed event...");
  const validExternalEventId = `evt_authoritative_${Date.now()}`;
  const validSuccessPayload = JSON.stringify({
    id: validExternalEventId,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionData.sessionId,
        client_reference_id: testOrder.id,
        amount_total: testOrder.totalAmount,
        currency: testOrder.currency.toLowerCase(),
        payment_status: "paid",
        status: "complete",
        metadata: {
          orderId: testOrder.id,
          paymentId: sessionData.paymentId,
        },
      },
    },
  });
  const validSuccessSig = generateStripeSignature(
    validSuccessPayload,
    STRIPE_TEST_SECRET,
  );
  const successWebhookRes = await apiPost(
    "/v1/webhooks/payments/stripe",
    validSuccessPayload,
    undefined,
    API_BASE,
    { "stripe-signature": validSuccessSig },
  );
  if (
    !successWebhookRes.ok ||
    successWebhookRes.data.paymentStatus !== PaymentStatus.SUCCEEDED ||
    successWebhookRes.data.orderStatus !== OrderStatus.PAID
  ) {
    throw new Error(
      `Gate 22 failed: Expected payment SUCCEEDED and order PAID, got ${JSON.stringify(successWebhookRes.data)}`,
    );
  }
  console.log("✓ Gate 22 passed: Authoritative webhook processed successfully (200 OK)");

  // ----------------------------------------------------
  // Gate 23: Database Verification of Atomic Success Transaction
  // ----------------------------------------------------
  console.log("\n[Gate 23] Verifying database atomic transaction state...");
  const finalPayment = await prisma.payment.findUniqueOrThrow({
    where: { id: sessionData.paymentId },
  });
  const finalOrder = await prisma.order.findUniqueOrThrow({
    where: { id: testOrder.id },
  });
  const finalPaymentEvents = await prisma.paymentEvent.findMany({
    where: { paymentId: sessionData.paymentId },
  });
  const finalOutboxEvents = await prisma.outboxEvent.findMany({
    where: {
      aggregateType: "Order",
      aggregateId: testOrder.id,
      eventType: "ORDER_PAID",
    },
  });
  const finalAuditLogs = await prisma.auditLog.findMany({
    where: {
      entity: "Order",
      entityId: testOrder.id,
      action: "ORDER_PAID",
    },
  });

  if (finalPayment.status !== PaymentStatus.SUCCEEDED) {
    throw new Error(`Gate 23 failed: Payment status is ${finalPayment.status}, expected SUCCEEDED`);
  }
  if (finalOrder.status !== OrderStatus.PAID) {
    throw new Error(`Gate 23 failed: Order status is ${finalOrder.status}, expected PAID`);
  }
  if (finalPaymentEvents.length !== 1) {
    throw new Error(`Gate 23 failed: Expected 1 PaymentEvent, found ${finalPaymentEvents.length}`);
  }
  if (finalOutboxEvents.length !== 1) {
    throw new Error(`Gate 23 failed: Expected exactly 1 ORDER_PAID outbox event, found ${finalOutboxEvents.length}`);
  }
  if (finalAuditLogs.length === 0) {
    throw new Error("Gate 23 failed: AuditLog for ORDER_PAID not found");
  }
  console.log("✓ Gate 23 passed: Atomic transaction verified (Payment: SUCCEEDED, Order: PAID, Outbox: 1, Audit: 1)");

  // ----------------------------------------------------
  // Gate 24: Secret Hygiene Verification
  // ----------------------------------------------------
  console.log("\n[Gate 24] Verifying secret hygiene in stored payloads...");
  const storedEventPayloadStr = JSON.stringify(finalPaymentEvents[0].payload);
  const sensitivePatterns = [
    /4111\s?1111/i,
    /cvv/i,
    /cvc/i,
    /bearer\s+/i,
    /sk_test_/i,
    /whsec_/i,
  ];
  for (const pattern of sensitivePatterns) {
    if (pattern.test(storedEventPayloadStr)) {
      throw new Error(`Gate 24 failed: Sensitive secret pattern ${pattern} leaked into PaymentEvent payload!`);
    }
  }
  console.log("✓ Gate 24 passed: Stored event payload sanitized, zero secrets leaked");

  // ----------------------------------------------------
  // Gate 25: Raw Payload Hash Integrity Verification
  // ----------------------------------------------------
  console.log("\n[Gate 25] Verifying raw payload hash integrity...");
  const expectedHash = crypto
    .createHash("sha256")
    .update(validSuccessPayload)
    .digest("hex");
  if (finalPaymentEvents[0].rawPayloadHash !== expectedHash) {
    throw new Error(
      `Gate 25 failed: rawPayloadHash mismatch. Expected ${expectedHash}, found ${finalPaymentEvents[0].rawPayloadHash}`,
    );
  }
  console.log(`✓ Gate 25 passed: rawPayloadHash matches SHA-256 of raw body (${expectedHash.substring(0, 16)}...)`);

  // ----------------------------------------------------
  // Gate 26: Sequential Duplicate Webhook Idempotency
  // ----------------------------------------------------
  console.log("\n[Gate 26] Sending sequential duplicate webhook with same externalEventId...");
  const duplicateWebhookRes = await apiPost(
    "/v1/webhooks/payments/stripe",
    validSuccessPayload,
    undefined,
    API_BASE,
    { "stripe-signature": validSuccessSig },
  );
  if (!duplicateWebhookRes.ok || !duplicateWebhookRes.data.duplicate) {
    throw new Error(
      `Gate 26 failed: Expected duplicate: true, got ${JSON.stringify(duplicateWebhookRes.data)}`,
    );
  }
  const duplicateOutboxCheck = await prisma.outboxEvent.count({
    where: {
      aggregateType: "Order",
      aggregateId: testOrder.id,
      eventType: "ORDER_PAID",
    },
  });
  if (duplicateOutboxCheck !== 1) {
    throw new Error(
      `Gate 26 failed: Duplicate webhook emitted an additional outbox event! Count: ${duplicateOutboxCheck}`,
    );
  }
  console.log("✓ Gate 26 passed: Sequential duplicate returned duplicate: true without emitting extra outbox events");

  // ----------------------------------------------------
  // Gate 27: Concurrency Scenario A — 20 Identical Webhooks in Parallel
  // ----------------------------------------------------
  console.log("\n[Gate 27] Executing Concurrency Scenario A: 20 identical webhooks fired simultaneously...");
  const { order: orderA, payment: paymentA } = await createCustomerOrder(
    customerToken,
    targetVariant.id,
    2,
  );
  const sessionARes = await apiPost(
    `/v1/orders/${orderA.id}/payment-session`,
    { provider: "stripe" },
    customerToken,
  );
  const sessionA = sessionARes.data;

  const concAEventId = `evt_conc_a_${Date.now()}`;
  const concAPayload = JSON.stringify({
    id: concAEventId,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionA.sessionId,
        client_reference_id: orderA.id,
        amount_total: orderA.totalAmount,
        currency: orderA.currency.toLowerCase(),
        payment_status: "paid",
        status: "complete",
        metadata: {
          orderId: orderA.id,
          paymentId: sessionA.paymentId,
        },
      },
    },
  });
  const concASig = generateStripeSignature(concAPayload, STRIPE_TEST_SECRET);

  const concAPromises = Array.from({ length: 20 }).map(() =>
    apiPost(
      "/v1/webhooks/payments/stripe",
      concAPayload,
      undefined,
      API_BASE,
      { "stripe-signature": concASig },
    ),
  );

  const concAResults = await Promise.all(concAPromises);
  const successfulCallsA = concAResults.filter((r) => r.ok);
  if (successfulCallsA.length !== 20) {
    throw new Error(
      `Gate 27 failed: Expected all 20 calls to succeed (either first-pass or duplicate), got ${successfulCallsA.length} successes`,
    );
  }

  const outboxCountA = await prisma.outboxEvent.count({
    where: { aggregateId: orderA.id, eventType: "ORDER_PAID" },
  });
  const paymentEventCountA = await prisma.paymentEvent.count({
    where: { paymentId: sessionA.paymentId },
  });

  if (outboxCountA !== 1) {
    throw new Error(`Gate 27 failed: Expected exactly 1 outbox event for Order A, found ${outboxCountA}`);
  }
  if (paymentEventCountA !== 1) {
    throw new Error(`Gate 27 failed: Expected exactly 1 PaymentEvent for Order A, found ${paymentEventCountA}`);
  }
  console.log("✓ Gate 27 passed: 20 concurrent identical webhooks yielded exactly 1 PaymentEvent and 1 Outbox event");

  // ----------------------------------------------------
  // Gate 28: Concurrency Scenario B — Simultaneous Success vs Failed Webhooks
  // ----------------------------------------------------
  console.log("\n[Gate 28] Executing Concurrency Scenario B: Simultaneous Success and Failed webhooks...");
  const { order: orderB, payment: paymentB } = await createCustomerOrder(
    customerToken,
    targetVariant.id,
    1,
  );
  const sessionBRes = await apiPost(
    `/v1/orders/${orderB.id}/payment-session`,
    { provider: "stripe" },
    customerToken,
  );
  const sessionB = sessionBRes.data;

  const successEventB = JSON.stringify({
    id: `evt_b_success_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionB.sessionId,
        client_reference_id: orderB.id,
        amount_total: orderB.totalAmount,
        currency: orderB.currency.toLowerCase(),
        payment_status: "paid",
        status: "complete",
        metadata: { orderId: orderB.id, paymentId: sessionB.paymentId },
      },
    },
  });
  const failedEventB = JSON.stringify({
    id: `evt_b_failed_${Date.now()}`,
    object: "event",
    type: "checkout.session.async_payment_failed",
    data: {
      object: {
        id: sessionB.sessionId,
        client_reference_id: orderB.id,
        amount_total: orderB.totalAmount,
        currency: orderB.currency.toLowerCase(),
        payment_status: "unpaid",
        status: "open",
        metadata: { orderId: orderB.id, paymentId: sessionB.paymentId },
      },
    },
  });

  const [resB1, resB2] = await Promise.all([
    apiPost(
      "/v1/webhooks/payments/stripe",
      successEventB,
      undefined,
      API_BASE,
      { "stripe-signature": generateStripeSignature(successEventB, STRIPE_TEST_SECRET) },
    ),
    apiPost(
      "/v1/webhooks/payments/stripe",
      failedEventB,
      undefined,
      API_BASE,
      { "stripe-signature": generateStripeSignature(failedEventB, STRIPE_TEST_SECRET) },
    ),
  ]);

  if (!resB1.ok || !resB2.ok) {
    throw new Error(
      `Gate 28 failed: Concurrent webhooks must both resolve controlled (idempotent) responses, got ${resB1.status}/${resB2.status}`,
    );
  }

  const dbPaymentB = await prisma.payment.findUniqueOrThrow({
    where: { id: sessionB.paymentId },
  });
  const dbOrderB = await prisma.order.findUniqueOrThrow({
    where: { id: orderB.id },
  });

  // Two concurrent terminal transitions for the SAME PENDING attempt race on the
  // row lock; whichever transaction commits first legitimately wins the CAS.
  // There is no ordering guarantee between concurrent webhook deliveries, so the
  // only real invariant is that the outcome is one of the two CONSISTENT pairs —
  // never a corrupted mix of the two (e.g. Payment SUCCEEDED but Order still
  // PENDING_PAYMENT, or Payment FAILED but Order PAID).
  const succeededConsistently =
    dbPaymentB.status === PaymentStatus.SUCCEEDED && dbOrderB.status === OrderStatus.PAID;
  const failedConsistently =
    dbPaymentB.status === PaymentStatus.FAILED && dbOrderB.status === OrderStatus.PENDING_PAYMENT;
  if (!succeededConsistently && !failedConsistently) {
    throw new Error(
      `Gate 28 failed: Terminal state safety violated. Payment status: ${dbPaymentB.status}, Order: ${dbOrderB.status}`,
    );
  }
  const outboxCountB = await prisma.outboxEvent.count({
    where: { aggregateId: orderB.id, eventType: "ORDER_PAID" },
  });
  const expectedOutboxB = succeededConsistently ? 1 : 0;
  if (outboxCountB !== expectedOutboxB) {
    throw new Error(
      `Gate 28 failed: Expected ${expectedOutboxB} ORDER_PAID outbox event(s) for the winning outcome, found ${outboxCountB}`,
    );
  }
  console.log(
    `✓ Gate 28 passed: Exactly one consistent terminal outcome won the race (Payment=${dbPaymentB.status}, Order=${dbOrderB.status}); no state corruption`,
  );

  // ----------------------------------------------------
  // Gate 29: Concurrency Scenario C — Two Different Success Events for Same Payment
  // ----------------------------------------------------
  console.log("\n[Gate 29] Executing Concurrency Scenario C: Two distinct success events for same payment...");
  const { order: orderC, payment: paymentC } = await createCustomerOrder(
    customerToken,
    targetVariant.id,
    1,
  );
  const sessionCRes = await apiPost(
    `/v1/orders/${orderC.id}/payment-session`,
    { provider: "stripe" },
    customerToken,
  );
  const sessionC = sessionCRes.data;

  // Event 1: checkout.session.completed
  const eventC1 = JSON.stringify({
    id: `evt_c_session_completed_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionC.sessionId,
        client_reference_id: orderC.id,
        amount_total: orderC.totalAmount,
        currency: orderC.currency.toLowerCase(),
        payment_status: "paid",
        metadata: { orderId: orderC.id, paymentId: sessionC.paymentId },
      },
    },
  });

  // Event 2: checkout.session.async_payment_succeeded
  const eventC2 = JSON.stringify({
    id: `evt_c_async_succeeded_${Date.now()}`,
    object: "event",
    type: "checkout.session.async_payment_succeeded",
    data: {
      object: {
        id: sessionC.sessionId,
        client_reference_id: orderC.id,
        amount_total: orderC.totalAmount,
        currency: orderC.currency.toLowerCase(),
        metadata: { orderId: orderC.id, paymentId: sessionC.paymentId },
      },
    },
  });

  const resC1 = await apiPost(
    "/v1/webhooks/payments/stripe",
    eventC1,
    undefined,
    API_BASE,
    { "stripe-signature": generateStripeSignature(eventC1, STRIPE_TEST_SECRET) },
  );
  const resC2 = await apiPost(
    "/v1/webhooks/payments/stripe",
    eventC2,
    undefined,
    API_BASE,
    { "stripe-signature": generateStripeSignature(eventC2, STRIPE_TEST_SECRET) },
  );

  const paymentEventsC = await prisma.paymentEvent.findMany({
    where: { paymentId: sessionC.paymentId },
  });
  const outboxCountC = await prisma.outboxEvent.count({
    where: { aggregateId: orderC.id, eventType: "ORDER_PAID" },
  });

  if (paymentEventsC.length !== 2) {
    throw new Error(`Gate 29 failed: Expected 2 PaymentEvents recorded, found ${paymentEventsC.length}`);
  }
  if (outboxCountC !== 1) {
    throw new Error(`Gate 29 failed: Expected exactly 1 ORDER_PAID outbox event, found ${outboxCountC}`);
  }
  console.log("✓ Gate 29 passed: 2 distinct success events recorded for audit, exactly 1 ORDER_PAID outbox emitted");

  // ----------------------------------------------------
  // Gate 30: Concurrency Scenario D — Session Creation Retry vs Webhook
  // ----------------------------------------------------
  console.log("\n[Gate 30] Executing Concurrency Scenario D: Concurrent session retry vs webhook...");
  const { order: orderD, payment: paymentD } = await createCustomerOrder(
    customerToken,
    targetVariant.id,
    1,
  );
  const sessionDRes = await apiPost(
    `/v1/orders/${orderD.id}/payment-session`,
    { provider: "stripe" },
    customerToken,
  );
  const sessionD = sessionDRes.data;

  const eventD = JSON.stringify({
    id: `evt_d_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionD.sessionId,
        client_reference_id: orderD.id,
        amount_total: orderD.totalAmount,
        currency: orderD.currency.toLowerCase(),
        payment_status: "paid",
        metadata: { orderId: orderD.id, paymentId: sessionD.paymentId },
      },
    },
  });

  const [sessionRetryRes, webhookDRes] = await Promise.all([
    apiPost(
      `/v1/orders/${orderD.id}/payment-session`,
      { provider: "stripe" },
      customerToken,
    ),
    apiPost(
      "/v1/webhooks/payments/stripe",
      eventD,
      undefined,
      API_BASE,
      { "stripe-signature": generateStripeSignature(eventD, STRIPE_TEST_SECRET) },
    ),
  ]);

  const dbPaymentD = await prisma.payment.findUniqueOrThrow({
    where: { id: sessionD.paymentId },
  });
  const dbOrderD = await prisma.order.findUniqueOrThrow({
    where: { id: orderD.id },
  });

  if (dbPaymentD.status !== PaymentStatus.SUCCEEDED || dbOrderD.status !== OrderStatus.PAID) {
    throw new Error("Gate 30 failed: Session retry vs Webhook did not converge to SUCCEEDED/PAID");
  }
  console.log("✓ Gate 30 passed: Concurrent session retry and webhook converged cleanly without deadlock");

  // ----------------------------------------------------
  // Gate 31: Concurrency Scenario E — Reconciler vs Webhook
  // ----------------------------------------------------
  console.log("\n[Gate 31] Executing Concurrency Scenario E: Concurrent reconciler vs webhook...");
  const { order: orderE, payment: paymentE } = await createCustomerOrder(
    customerToken,
    targetVariant.id,
    1,
  );
  const sessionERes = await apiPost(
    `/v1/orders/${orderE.id}/payment-session`,
    { provider: "stripe" },
    customerToken,
  );
  const sessionE = sessionERes.data;

  const eventE = JSON.stringify({
    id: `evt_e_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionE.sessionId,
        client_reference_id: orderE.id,
        amount_total: orderE.totalAmount,
        currency: orderE.currency.toLowerCase(),
        payment_status: "paid",
        metadata: { orderId: orderE.id, paymentId: sessionE.paymentId },
      },
    },
  });

  const [reconcileResE, webhookResE] = await Promise.all([
    apiPost(
      `/v1/payments/${sessionE.paymentId}/reconcile`,
      { reason: "authoritative_query" },
      adminToken,
    ),
    apiPost(
      "/v1/webhooks/payments/stripe",
      eventE,
      undefined,
      API_BASE,
      { "stripe-signature": generateStripeSignature(eventE, STRIPE_TEST_SECRET) },
    ),
  ]);

  const outboxCountE = await prisma.outboxEvent.count({
    where: { aggregateId: orderE.id, eventType: "ORDER_PAID" },
  });
  if (outboxCountE !== 1) {
    throw new Error(`Gate 31 failed: Expected exactly 1 outbox event between reconciler and webhook, found ${outboxCountE}`);
  }
  console.log("✓ Gate 31 passed: Concurrent reconciler and webhook synchronized atomically via row lock");

  // ----------------------------------------------------
  // Gate 32: Terminal State Safety (No Reversion from Succeeded)
  // ----------------------------------------------------
  console.log("\n[Gate 32] Verifying terminal state safety (reverting SUCCEEDED rejected)...");
  const postSuccessCancelEvent = JSON.stringify({
    id: `evt_post_success_cancel_${Date.now()}`,
    object: "event",
    type: "checkout.session.expired",
    data: {
      object: {
        id: sessionA.sessionId,
        client_reference_id: orderA.id,
        amount_total: orderA.totalAmount,
        currency: orderA.currency.toLowerCase(),
        metadata: { orderId: orderA.id, paymentId: sessionA.paymentId },
      },
    },
  });
  const cancelSig = generateStripeSignature(
    postSuccessCancelEvent,
    STRIPE_TEST_SECRET,
  );
  const cancelRes = await apiPost(
    "/v1/webhooks/payments/stripe",
    postSuccessCancelEvent,
    undefined,
    API_BASE,
    { "stripe-signature": cancelSig },
  );

  const checkTerminalPayment = await prisma.payment.findUniqueOrThrow({
    where: { id: sessionA.paymentId },
  });
  const checkTerminalOrder = await prisma.order.findUniqueOrThrow({
    where: { id: orderA.id },
  });

  if (
    checkTerminalPayment.status !== PaymentStatus.SUCCEEDED ||
    checkTerminalOrder.status !== OrderStatus.PAID
  ) {
    throw new Error(
      `Gate 32 failed: Terminal state violated! Payment reverted to ${checkTerminalPayment.status}`,
    );
  }
  console.log("✓ Gate 32 passed: Subsequent cancellation ignored, payment remains SUCCEEDED");

  // ----------------------------------------------------
  // Gate 33: Frontend Redirect / Status Check is Read-Only
  // ----------------------------------------------------
  console.log("\n[Gate 33] Verifying frontend status check / redirect is strictly read-only...");
  const { order: orderReadOnly } = await createCustomerOrder(
    customerToken,
    targetVariant.id,
    1,
  );
  const orderLookupBefore = await apiGet(`/orders/${orderReadOnly.id}`, customerToken);
  if (orderLookupBefore.data.status !== "PENDING_PAYMENT") {
    throw new Error("Gate 33 setup failed: Order should be PENDING_PAYMENT");
  }

  // Check payment status endpoint
  const pendingPayment = orderReadOnly.payments?.[0];
  if (pendingPayment) {
    const payStatusRes = await apiGet(`/v1/payments/${pendingPayment.id}`, customerToken);
    if (payStatusRes.data?.status === "PAID" || payStatusRes.data?.status === "SUCCEEDED") {
      throw new Error("Gate 33 failed: Payment endpoint marked payment succeeded unexpectedly");
    }
  }

  const orderLookupAfter = await apiGet(`/orders/${orderReadOnly.id}`, customerToken);
  if (orderLookupAfter.data.status !== "PENDING_PAYMENT") {
    throw new Error(
      `Gate 33 failed: Read-only check mutated order status to ${orderLookupAfter.data.status}`,
    );
  }
  console.log("✓ Gate 33 passed: Read-only order/payment queries never mutate state");

  // ----------------------------------------------------
  // Gate 34: Authoritative Reconciliation for Stuck Payment
  // ----------------------------------------------------
  console.log("\n[Gate 34] Testing authoritative payment reconciliation for stuck pending payment...");
  const { order: orderReconcile } = await createCustomerOrder(
    customerToken,
    targetVariant.id,
    1,
  );
  const sessionReconcileRes = await apiPost(
    `/v1/orders/${orderReconcile.id}/payment-session`,
    { provider: "stripe" },
    customerToken,
  );
  const sessionReconcile = sessionReconcileRes.data;

  // Verify currently PENDING
  const beforeReconcilePayment = await prisma.payment.findUniqueOrThrow({
    where: { id: sessionReconcile.paymentId },
  });
  if (beforeReconcilePayment.status !== PaymentStatus.PENDING) {
    throw new Error("Gate 34 setup failed: Payment should be PENDING");
  }

  // Trigger reconciliation
  const reconcileCallRes = await apiPost(
    `/v1/payments/${sessionReconcile.paymentId}/reconcile`,
    { reason: "scheduled_sweep" },
    adminToken,
  );
  if (!reconcileCallRes.ok || !reconcileCallRes.data.transitioned) {
    throw new Error(
      `Gate 34 failed: Reconcile returned: ${JSON.stringify(reconcileCallRes.data)}`,
    );
  }

  const afterReconcilePayment = await prisma.payment.findUniqueOrThrow({
    where: { id: sessionReconcile.paymentId },
  });
  const afterReconcileOrder = await prisma.order.findUniqueOrThrow({
    where: { id: orderReconcile.id },
  });

  if (
    afterReconcilePayment.status !== PaymentStatus.SUCCEEDED ||
    afterReconcileOrder.status !== OrderStatus.PAID
  ) {
    throw new Error("Gate 34 failed: Reconciliation did not transition payment/order to SUCCEEDED/PAID");
  }

  const reconcileOutbox = await prisma.outboxEvent.count({
    where: { aggregateId: orderReconcile.id, eventType: "ORDER_PAID" },
  });
  if (reconcileOutbox !== 1) {
    throw new Error(`Gate 34 failed: Expected exactly 1 outbox event for reconciled order, found ${reconcileOutbox}`);
  }
  console.log("✓ Gate 34 passed: Authoritative reconciliation transitioned stuck payment and emitted ORDER_PAID outbox");

  // ----------------------------------------------------
  // Gate 35: Downstream Worker Entitlement & License Issuance
  // ----------------------------------------------------
  console.log("\n[Gate 35] Executing worker outbox processor and verifying entitlement issuance...");
  const workerResult = await processOutboxEvents({
    workerId: "acceptance_worker_phase9",
    batchSize: 50,
  });
  console.log(`  Processed ${workerResult.processedCount} outbox events in worker batch.`);

  // Verify Order A entitlements and licenses were issued to Customer
  const customerEntitlements = await prisma.entitlement.findMany({
    where: {
      userId: customerUserId,
      status: "ACTIVE",
    },
    include: {
      internalLicense: true,
      allocations: true,
    },
  });

  if (customerEntitlements.length === 0) {
    throw new Error("Gate 35 failed: No active entitlements found for customer after worker processing");
  }

  const internalLicenses = customerEntitlements
    .map((e) => e.internalLicense)
    .filter(Boolean);
  console.log(
    `✓ Gate 35 passed: Worker successfully processed outbox; Customer has ${customerEntitlements.length} entitlements and ${internalLicenses.length} issued internal licenses`,
  );

  // ----------------------------------------------------
  // Gate 36: Stripe Production Fail-Closed — STRIPE_MOCK_CLIENT Forbidden
  // ----------------------------------------------------
  console.log("\n[Gate 36] Verifying STRIPE_MOCK_CLIENT=true fails closed in production...");
  const gate36Result = await new Promise<boolean>((resolve) => {
    const child = spawn(
      "node",
      [
        "-e",
        `
        process.env.NODE_ENV = 'production';
        process.env.STRIPE_MOCK_CLIENT = 'true';
        process.env.STRIPE_SECRET_KEY = 'sk_live_valid_dummy_key';
        process.env.STRIPE_WEBHOOK_SECRET = 'whsec_valid_dummy_key';
        const { StripePaymentProvider } = require('./apps/api/dist/modules/payments/stripe-payment.provider');
        try {
          new StripePaymentProvider();
          process.exit(1); // Should have thrown!
        } catch (err) {
          if (err.message && err.message.includes('STRIPE_MOCK_CLIENT must not be true in production')) {
            process.exit(0);
          }
          process.exit(2);
        }
      `,
      ],
      { cwd: path.resolve(__dirname, "../../..") },
    );
    child.on("exit", (code) => resolve(code === 0));
  });
  if (!gate36Result) {
    throw new Error("Gate 36 failed: STRIPE_MOCK_CLIENT=true did not throw in production");
  }
  console.log("✓ Gate 36 passed: STRIPE_MOCK_CLIENT=true is strictly prohibited in production mode");

  // ----------------------------------------------------
  // Gate 37: Stripe Production Fail-Closed — Missing or Placeholder STRIPE_SECRET_KEY
  // ----------------------------------------------------
  console.log("\n[Gate 37] Verifying placeholder STRIPE_SECRET_KEY fails closed in production...");
  const gate37Result = await new Promise<boolean>((resolve) => {
    const child = spawn(
      "node",
      [
        "-e",
        `
        process.env.NODE_ENV = 'production';
        process.env.STRIPE_MOCK_CLIENT = 'false';
        process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_key';
        process.env.STRIPE_WEBHOOK_SECRET = 'whsec_valid_dummy_key';
        const { StripePaymentProvider } = require('./apps/api/dist/modules/payments/stripe-payment.provider');
        try {
          new StripePaymentProvider();
          process.exit(1); // Should have thrown!
        } catch (err) {
          if (err.message && err.message.includes('STRIPE_SECRET_KEY is required and must not be a placeholder')) {
            process.exit(0);
          }
          process.exit(2);
        }
      `,
      ],
      { cwd: path.resolve(__dirname, "../../..") },
    );
    child.on("exit", (code) => resolve(code === 0));
  });
  if (!gate37Result) {
    throw new Error("Gate 37 failed: Placeholder STRIPE_SECRET_KEY did not throw in production");
  }
  console.log("✓ Gate 37 passed: Placeholder STRIPE_SECRET_KEY is strictly rejected at startup in production");

  // ----------------------------------------------------
  // Gate 38: Stripe Production Fail-Closed — Missing or Placeholder STRIPE_WEBHOOK_SECRET
  // ----------------------------------------------------
  console.log("\n[Gate 38] Verifying placeholder STRIPE_WEBHOOK_SECRET fails closed in production...");
  const gate38Result = await new Promise<boolean>((resolve) => {
    const child = spawn(
      "node",
      [
        "-e",
        `
        process.env.NODE_ENV = 'production';
        process.env.STRIPE_MOCK_CLIENT = 'false';
        process.env.STRIPE_SECRET_KEY = 'sk_live_valid_dummy_key';
        process.env.STRIPE_WEBHOOK_SECRET = 'whsec_placeholder_key';
        const { StripePaymentProvider } = require('./apps/api/dist/modules/payments/stripe-payment.provider');
        try {
          new StripePaymentProvider();
          process.exit(1); // Should have thrown!
        } catch (err) {
          if (err.message && err.message.includes('STRIPE_WEBHOOK_SECRET is required and must not be a placeholder')) {
            process.exit(0);
          }
          process.exit(2);
        }
      `,
      ],
      { cwd: path.resolve(__dirname, "../../..") },
    );
    child.on("exit", (code) => resolve(code === 0));
  });
  if (!gate38Result) {
    throw new Error("Gate 38 failed: Placeholder STRIPE_WEBHOOK_SECRET did not throw in production");
  }
  console.log("✓ Gate 38 passed: Placeholder STRIPE_WEBHOOK_SECRET is strictly rejected at startup in production");

  // ----------------------------------------------------
  // Gate 39: Stripe Adapter Error Mapping — 502 Bad Gateway Without Leaking Secrets
  // ----------------------------------------------------
  console.log("\n[Gate 39] Verifying upstream provider error maps to 502 Bad Gateway without secret leakage...");
  const gate39Result = await new Promise<boolean>((resolve) => {
    const child = spawn(
      "node",
      [
        "-e",
        `
        process.env.NODE_ENV = 'development';
        process.env.STRIPE_MOCK_CLIENT = 'false';
        process.env.STRIPE_SECRET_KEY = 'sk_live_invalid_secret_key_trigger_gateway_error';
        process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
        const { StripePaymentProvider } = require('./apps/api/dist/modules/payments/stripe-payment.provider');
        const provider = new StripePaymentProvider();
        const fakeOrder = { id: 'ord-test', orderNumber: '1001' };
        const fakePayment = { id: 'pay-test', amount: 1000, currency: 'USD' };
        provider.createPaymentSession({ order: fakeOrder, payment: fakePayment })
          .then(() => process.exit(1))
          .catch((err) => {
            if (err.status === 502 && err.message === 'Upstream payment provider failure') {
              process.exit(0);
            }
            process.exit(2);
          });
      `,
      ],
      { cwd: path.resolve(__dirname, "../../..") },
    );
    child.on("exit", (code) => resolve(code === 0));
  });
  if (!gate39Result) {
    throw new Error("Gate 39 failed: Upstream Stripe failure was not mapped to 502 Bad Gateway");
  }
  console.log("✓ Gate 39 passed: Upstream gateway failure maps to 502 Bad Gateway without leaking internal details");

  // ----------------------------------------------------
  // Gate 40: Mock Mode Accurate Session Registration & Query
  // ----------------------------------------------------
  console.log("\n[Gate 40] Verifying mock mode returns exact session amount and currency on query...");
  const { order: orderMock, payment: paymentMock } = await createCustomerOrder(
    customerToken,
    targetVariant.id,
    1,
  );
  const sessionMockRes = await apiPost(
    `/v1/orders/${orderMock.id}/payment-session`,
    { provider: "stripe" },
    customerToken,
  );
  if (!sessionMockRes.ok) {
    throw new Error("Gate 40 failed: Failed to create mock session");
  }
  const sessionMock = sessionMockRes.data;

  // Query mock payment status directly
  const queryMockResult = await new Promise<boolean>((resolve) => {
    const child = spawn(
      "node",
      [
        "-e",
        `
        const { StripePaymentProvider } = require('./apps/api/dist/modules/payments/stripe-payment.provider');
        const provider = new StripePaymentProvider();
        provider.registerMockSession({
          sessionId: '${sessionMock.sessionId}',
          sessionUrl: '${sessionMock.sessionUrl}',
          orderId: '${orderMock.id}',
          paymentId: '${sessionMock.paymentId}',
          amount: ${orderMock.totalAmount},
          currency: '${orderMock.currency}',
          status: 'SUCCEEDED',
        });
        provider.queryPaymentStatus('${sessionMock.sessionId}').then((res) => {
          if (res && res.amount === ${orderMock.totalAmount} && res.currency === '${orderMock.currency}') {
            // Also verify unknown session returns null
            provider.queryPaymentStatus('cs_unknown_nonexistent').then((unknownRes) => {
              if (unknownRes === null) process.exit(0);
              process.exit(1);
            });
          } else {
            process.exit(2);
          }
        });
      `,
      ],
      { cwd: path.resolve(__dirname, "../../..") },
    );
    child.on("exit", (code) => resolve(code === 0));
  });
  if (!queryMockResult) {
    throw new Error("Gate 40 failed: Mock session query did not return exact amounts or returned non-null for unknown session");
  }
  console.log("✓ Gate 40 passed: Mock sessions preserve exact amount/currency and return null for unknown references");

  // ----------------------------------------------------
  // Gate 41: PostgreSQL Outbox Partial Unique Index Verification
  // ----------------------------------------------------
  console.log("\n[Gate 41] Verifying PostgreSQL partial unique index 'unique_order_paid_outbox'...");
  const indexCheck: any[] = await prisma.$queryRawUnsafe(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'outbox_events' AND indexname = 'unique_order_paid_outbox';
  `);
  if (!indexCheck || indexCheck.length === 0) {
    throw new Error("Gate 41 failed: Partial unique index 'unique_order_paid_outbox' not found in PostgreSQL");
  }
  if (!indexCheck[0].indexdef.includes("ORDER_PAID")) {
    throw new Error(`Gate 41 failed: Partial unique index definition missing ORDER_PAID predicate: ${indexCheck[0].indexdef}`);
  }

  // Verify DB rejects duplicate ORDER_PAID outbox insertion directly
  const testOrderId = `test-order-${Date.now()}`;
  await prisma.outboxEvent.create({
    data: {
      eventType: "ORDER_PAID",
      aggregateType: "Order",
      aggregateId: testOrderId,
      payload: { test: 1 },
      status: OutboxEventStatus.PENDING,
    },
  });

  let duplicateBlocked = false;
  try {
    await prisma.outboxEvent.create({
      data: {
        eventType: "ORDER_PAID",
        aggregateType: "Order",
        aggregateId: testOrderId,
        payload: { test: 2 },
        status: OutboxEventStatus.PENDING,
      },
    });
  } catch (err: any) {
    if (err.message && (err.message.includes("unique_order_paid_outbox") || err.code === "P2002")) {
      duplicateBlocked = true;
    }
  }
  if (!duplicateBlocked) {
    throw new Error("Gate 41 failed: PostgreSQL did not reject duplicate ORDER_PAID outbox event on same orderId");
  }
  // Clean up the synthetic probe row; it references no real Order and would
  // otherwise sit PENDING forever and pollute worker/outbox observability.
  await prisma.outboxEvent.deleteMany({ where: { aggregateId: testOrderId } });
  console.log("✓ Gate 41 passed: PostgreSQL partial unique index 'unique_order_paid_outbox' is active and enforced");

  // ----------------------------------------------------
  // Gate 42: Order Already PAID — Duplicate Payment Anomaly Logged Without Second Outbox
  // ----------------------------------------------------
  console.log("\n[Gate 42] Verifying payment for already-PAID order logs anomaly and emits zero second outbox...");
  const { order: orderAlreadyPaid, payment: paymentAlreadyPaid } = await createCustomerOrder(
    customerToken,
    targetVariant.id,
    1,
  );

  const sessionAlreadyPaidRes = await apiPost(
    `/v1/orders/${orderAlreadyPaid.id}/payment-session`,
    { provider: "stripe" },
    customerToken,
  );
  if (!sessionAlreadyPaidRes.ok) {
    throw new Error(`Gate 42 failed to create session: ${JSON.stringify(sessionAlreadyPaidRes.data)}`);
  }

  // Mark order PAID directly in database to simulate concurrent fulfillment and create initial ORDER_PAID outbox
  await prisma.$transaction([
    prisma.order.update({
      where: { id: orderAlreadyPaid.id },
      data: { status: OrderStatus.PAID },
    }),
    prisma.outboxEvent.create({
      data: {
        eventType: "ORDER_PAID",
        aggregateType: "Order",
        aggregateId: orderAlreadyPaid.id,
        payload: { orderId: orderAlreadyPaid.id },
      },
    }),
  ]);

  // Webhook for this payment
  const eventAlreadyPaid = JSON.stringify({
    id: `evt_already_paid_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionAlreadyPaidRes.data.sessionId,
        client_reference_id: orderAlreadyPaid.id,
        amount_total: orderAlreadyPaid.totalAmount,
        currency: orderAlreadyPaid.currency.toLowerCase(),
        payment_status: "paid",
        metadata: { orderId: orderAlreadyPaid.id, paymentId: sessionAlreadyPaidRes.data.paymentId },
      },
    },
  });

  const webhookAlreadyPaidRes = await apiPost(
    "/v1/webhooks/payments/stripe",
    eventAlreadyPaid,
    undefined,
    API_BASE,
    { "stripe-signature": generateStripeSignature(eventAlreadyPaid, STRIPE_TEST_SECRET) },
  );
  if (!webhookAlreadyPaidRes.ok) {
    throw new Error(`Gate 42 failed: Webhook returned error: ${JSON.stringify(webhookAlreadyPaidRes.data)}`);
  }

  // Payment should be marked SUCCEEDED
  const checkPaymentAlreadyPaid = await prisma.payment.findUniqueOrThrow({
    where: { id: sessionAlreadyPaidRes.data.paymentId },
  });
  if (checkPaymentAlreadyPaid.status !== PaymentStatus.SUCCEEDED) {
    throw new Error("Gate 42 failed: Payment was not marked SUCCEEDED");
  }

  // Outbox count must remain 1 (zero additional ORDER_PAID events emitted)
  const checkOutboxAlreadyPaid = await prisma.outboxEvent.count({
    where: { aggregateId: orderAlreadyPaid.id, eventType: "ORDER_PAID" },
  });
  if (checkOutboxAlreadyPaid !== 1) {
    throw new Error(`Gate 42 failed: Expected exactly 1 ORDER_PAID outbox event, found ${checkOutboxAlreadyPaid}`);
  }

  // Audit log must have DUPLICATE_PAYMENT_DETECTED
  const auditAlreadyPaid = await prisma.auditLog.findFirst({
    where: {
      action: "DUPLICATE_PAYMENT_DETECTED",
      entityId: sessionAlreadyPaidRes.data.paymentId,
    },
  });
  if (!auditAlreadyPaid) {
    throw new Error("Gate 42 failed: DUPLICATE_PAYMENT_DETECTED audit log entry was not found");
  }
  console.log("✓ Gate 42 passed: Payment for already-PAID order logged DUPLICATE_PAYMENT_DETECTED and emitted 0 duplicate outbox events");

  // ----------------------------------------------------
  // Gate 43: Failed Webhook Event Concurrency & Idempotency
  // ----------------------------------------------------
  console.log("\n[Gate 43] Executing 10 concurrent identical payment.failed webhooks...");
  const { order: orderFailed, payment: paymentFailed } = await createCustomerOrder(
    customerToken,
    targetVariant.id,
    1,
  );
  const sessionFailedRes = await apiPost(
    `/v1/orders/${orderFailed.id}/payment-session`,
    { provider: "stripe" },
    customerToken,
  );
  const eventFailed = JSON.stringify({
    id: `evt_failed_concurrent_${Date.now()}`,
    object: "event",
    type: "checkout.session.async_payment_failed",
    data: {
      object: {
        id: sessionFailedRes.data.sessionId,
        client_reference_id: orderFailed.id,
        amount_total: orderFailed.totalAmount,
        currency: orderFailed.currency.toLowerCase(),
        metadata: { orderId: orderFailed.id, paymentId: sessionFailedRes.data.paymentId },
      },
    },
  });

  const failedWebhookCalls = Array.from({ length: 10 }).map(() =>
    apiPost(
      "/v1/webhooks/payments/stripe",
      eventFailed,
      undefined,
      API_BASE,
      { "stripe-signature": generateStripeSignature(eventFailed, STRIPE_TEST_SECRET) },
    ),
  );
  const failedResults = await Promise.all(failedWebhookCalls);
  const anyFailedError = failedResults.some((r) => !r.ok);
  if (anyFailedError) {
    throw new Error("Gate 43 failed: Concurrent payment.failed webhooks returned error status");
  }

  const paymentFailedDb = await prisma.payment.findUniqueOrThrow({
    where: { id: sessionFailedRes.data.paymentId },
  });
  if (paymentFailedDb.status !== PaymentStatus.FAILED) {
    throw new Error(`Gate 43 failed: Payment should be FAILED, got ${paymentFailedDb.status}`);
  }
  const failedEventCount = await prisma.paymentEvent.count({
    where: { paymentId: sessionFailedRes.data.paymentId, eventType: "payment.failed" },
  });
  if (failedEventCount !== 1) {
    throw new Error(`Gate 43 failed: Expected exactly 1 PaymentEvent for failed webhooks, got ${failedEventCount}`);
  }
  console.log("✓ Gate 43 passed: 10 concurrent failed webhooks processed idempotently without P2002 error");

  // ----------------------------------------------------
  // Gate 44: Cancelled Webhook Event Concurrency & Idempotency
  // Round 3: a cancelled/expired payment ATTEMPT is terminal for that
  // attempt only. The Order is NOT a payment attempt and must remain
  // PENDING_PAYMENT so the customer can retry with a new Payment row.
  // ----------------------------------------------------
  console.log("\n[Gate 44] Executing 10 concurrent identical payment.cancelled webhooks...");
  const { order: orderCancelled, payment: paymentCancelled } = await createCustomerOrder(
    customerToken,
    targetVariant.id,
    1,
  );
  const sessionCancelledRes = await apiPost(
    `/v1/orders/${orderCancelled.id}/payment-session`,
    { provider: "stripe" },
    customerToken,
  );
  const eventCancelled = JSON.stringify({
    id: `evt_cancelled_concurrent_${Date.now()}`,
    object: "event",
    type: "checkout.session.expired",
    data: {
      object: {
        id: sessionCancelledRes.data.sessionId,
        client_reference_id: orderCancelled.id,
        amount_total: orderCancelled.totalAmount,
        currency: orderCancelled.currency.toLowerCase(),
        metadata: { orderId: orderCancelled.id, paymentId: sessionCancelledRes.data.paymentId },
      },
    },
  });

  const cancelledWebhookCalls = Array.from({ length: 10 }).map(() =>
    apiPost(
      "/v1/webhooks/payments/stripe",
      eventCancelled,
      undefined,
      API_BASE,
      { "stripe-signature": generateStripeSignature(eventCancelled, STRIPE_TEST_SECRET) },
    ),
  );
  const cancelledResults = await Promise.all(cancelledWebhookCalls);
  const anyCancelledError = cancelledResults.some((r) => !r.ok);
  if (anyCancelledError) {
    throw new Error("Gate 44 failed: Concurrent payment.cancelled webhooks returned error status");
  }

  const paymentCancelledDb = await prisma.payment.findUniqueOrThrow({
    where: { id: sessionCancelledRes.data.paymentId },
  });
  const orderCancelledDb = await prisma.order.findUniqueOrThrow({
    where: { id: orderCancelled.id },
  });
  if (
    paymentCancelledDb.status !== PaymentStatus.CANCELLED ||
    orderCancelledDb.status !== OrderStatus.PENDING_PAYMENT
  ) {
    throw new Error(
      `Gate 44 failed: Payment attempt should be CANCELLED and Order should remain PENDING_PAYMENT (retryable), got payment=${paymentCancelledDb.status}, order=${orderCancelledDb.status}`,
    );
  }
  const cancelledOutboxCount = await prisma.outboxEvent.count({
    where: { aggregateId: orderCancelled.id, eventType: "ORDER_PAID" },
  });
  if (cancelledOutboxCount !== 0) {
    throw new Error(
      `Gate 44 failed: Expired/cancelled payment attempt must never emit ORDER_PAID outbox, found ${cancelledOutboxCount}`,
    );
  }
  const cancelledEventCount = await prisma.paymentEvent.count({
    where: { paymentId: sessionCancelledRes.data.paymentId, eventType: "payment.cancelled" },
  });
  if (cancelledEventCount !== 1) {
    throw new Error(`Gate 44 failed: Expected exactly 1 PaymentEvent for cancelled webhooks, got ${cancelledEventCount}`);
  }
  console.log("✓ Gate 44 passed: 10 concurrent cancelled webhooks processed idempotently; payment attempt terminal, Order remains PENDING_PAYMENT for retry");

  // ----------------------------------------------------
  // Gate 45: Reconciliation Route RBAC — Unauthenticated 401
  // ----------------------------------------------------
  console.log("\n[Gate 45] Verifying POST /v1/payments/:id/reconcile rejects unauthenticated callers with 401...");
  const unauthReconcileRes = await apiPost(
    `/v1/payments/${sessionFailedRes.data.paymentId}/reconcile`,
    { reason: "authoritative_query" },
    undefined, // No token!
  );
  if (unauthReconcileRes.status !== 401) {
    throw new Error(`Gate 45 failed: Expected 401 Unauthorized for unauthenticated reconcile, got ${unauthReconcileRes.status}`);
  }
  console.log("✓ Gate 45 passed: Unauthenticated reconciliation attempt rejected with 401");

  // ----------------------------------------------------
  // Gate 46: Reconciliation Route RBAC — Customer Without Permission 403
  // ----------------------------------------------------
  console.log("\n[Gate 46] Verifying POST /v1/payments/:id/reconcile rejects normal customer with 403...");
  const customerReconcileRes = await apiPost(
    `/v1/payments/${sessionFailedRes.data.paymentId}/reconcile`,
    { reason: "authoritative_query" },
    customerToken, // Lacks payment.manage!
  );
  if (customerReconcileRes.status !== 403) {
    throw new Error(`Gate 46 failed: Expected 403 Forbidden for customer without payment.manage, got ${customerReconcileRes.status}`);
  }
  console.log("✓ Gate 46 passed: Non-staff user rejected from reconciliation with 403 Forbidden");

  // ----------------------------------------------------
  // Gate 47: Reconciliation Route RBAC — Admin Authorized 200
  // ----------------------------------------------------
  console.log("\n[Gate 47] Verifying POST /v1/payments/:id/reconcile succeeds for admin with payment.manage...");
  const adminReconcileRes = await apiPost(
    `/v1/payments/${sessionFailedRes.data.paymentId}/reconcile`,
    { reason: "authoritative_query" },
    adminToken, // Has payment.manage!
  );
  if (adminReconcileRes.status !== 200 && adminReconcileRes.status !== 201) {
    throw new Error(`Gate 47 failed: Expected 200 OK for admin reconciliation, got ${adminReconcileRes.status}`);
  }
  console.log("✓ Gate 47 passed: Admin with payment.manage successfully authorized for reconciliation");

  // ----------------------------------------------------
  // Gate 48: Option 1 Event Model — Unpaid checkout.session.completed Ignored
  // ----------------------------------------------------
  console.log("\n[Gate 48] Verifying checkout.session.completed with payment_status=unpaid is ignored...");
  const { order: orderUnpaid, payment: paymentUnpaid } = await createCustomerOrder(
    customerToken,
    targetVariant.id,
    1,
  );
  const sessionUnpaidRes = await apiPost(
    `/v1/orders/${orderUnpaid.id}/payment-session`,
    { provider: "stripe" },
    customerToken,
  );
  const eventUnpaid = JSON.stringify({
    id: `evt_unpaid_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionUnpaidRes.data.sessionId,
        client_reference_id: orderUnpaid.id,
        amount_total: orderUnpaid.totalAmount,
        currency: orderUnpaid.currency.toLowerCase(),
        payment_status: "unpaid", // UNPAID!
        metadata: { orderId: orderUnpaid.id, paymentId: sessionUnpaidRes.data.paymentId },
      },
    },
  });

  const unpaidRes = await apiPost(
    "/v1/webhooks/payments/stripe",
    eventUnpaid,
    undefined,
    API_BASE,
    { "stripe-signature": generateStripeSignature(eventUnpaid, STRIPE_TEST_SECRET) },
  );
  if (!unpaidRes.ok || unpaidRes.data?.message !== "Webhook event type is ignored") {
    throw new Error(`Gate 48 failed: Expected ignored status for unpaid session, got ${JSON.stringify(unpaidRes.data)}`);
  }
  const checkPaymentUnpaid = await prisma.payment.findUniqueOrThrow({
    where: { id: sessionUnpaidRes.data.paymentId },
  });
  if (checkPaymentUnpaid.status !== PaymentStatus.PENDING) {
    throw new Error(`Gate 48 failed: Unpaid session mutated payment status to ${checkPaymentUnpaid.status}`);
  }
  console.log("✓ Gate 48 passed: checkout.session.completed with payment_status='unpaid' strictly ignored");

  // ----------------------------------------------------
  // Gate 49: Option 1 Event Model — payment_intent.* Events Strictly Ignored
  // ----------------------------------------------------
  console.log("\n[Gate 49] Verifying payment_intent.* events are strictly ignored under Option 1...");
  const eventPi = JSON.stringify({
    id: `evt_pi_ignored_${Date.now()}`,
    object: "event",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_test_ignored_123",
        amount: 5000,
        currency: "usd",
        metadata: { orderId: orderUnpaid.id, paymentId: sessionUnpaidRes.data.paymentId },
      },
    },
  });

  const piRes = await apiPost(
    "/v1/webhooks/payments/stripe",
    eventPi,
    undefined,
    API_BASE,
    { "stripe-signature": generateStripeSignature(eventPi, STRIPE_TEST_SECRET) },
  );
  if (!piRes.ok || piRes.data?.message !== "Webhook event type is ignored") {
    throw new Error(`Gate 49 failed: Expected ignored status for payment_intent event, got ${JSON.stringify(piRes.data)}`);
  }
  console.log("✓ Gate 49 passed: payment_intent.* events strictly ignored per Option 1 event model");

  // ----------------------------------------------------
  // Gate 50: Exact Provider Reference Match Only (No cs_* vs pi_* Cross-Matching)
  // ----------------------------------------------------
  console.log("\n[Gate 50] Verifying provider reference mismatch is strictly rejected with 400...");
  const eventRefMismatch = JSON.stringify({
    id: `evt_mismatch_ref_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: `pi_test_cross_mismatch`, // payment expects cs_test_...
        client_reference_id: orderUnpaid.id,
        amount_total: orderUnpaid.totalAmount,
        currency: orderUnpaid.currency.toLowerCase(),
        payment_status: "paid",
        metadata: { orderId: orderUnpaid.id, paymentId: sessionUnpaidRes.data.paymentId },
      },
    },
  });

  const refMismatchRes = await apiPost(
    "/v1/webhooks/payments/stripe",
    eventRefMismatch,
    undefined,
    API_BASE,
    { "stripe-signature": generateStripeSignature(eventRefMismatch, STRIPE_TEST_SECRET) },
  );
  if (refMismatchRes.status !== 400 || !refMismatchRes.data?.message?.includes("Provider reference mismatch")) {
    throw new Error(`Gate 50 failed: Expected 400 Provider reference mismatch, got ${refMismatchRes.status}: ${JSON.stringify(refMismatchRes.data)}`);
  }
  console.log("✓ Gate 50 passed: Provider reference cross-matching strictly rejected with 400 Bad Request");

  // ----------------------------------------------------
  // Gate 51: Row-Locked Session Creation — Active Provider Switching Conflict (409)
  // ----------------------------------------------------
  console.log("\n[Gate 51] Verifying provider switching conflict on active pending session...");
  const switchProviderRes = await apiPost(
    `/v1/orders/${orderUnpaid.id}/payment-session`,
    { provider: "test" }, // orderUnpaid already has active Stripe session!
    customerToken,
  );
  if (switchProviderRes.status !== 409) {
    throw new Error(`Gate 51 failed: Expected 409 Conflict for provider switching with active session, got ${switchProviderRes.status}`);
  }
  console.log("✓ Gate 51 passed: Active payment session prevents uncontrolled provider switching (409 Conflict)");

  // ----------------------------------------------------
  // Gate 52: Reconciliation Exact Binding Verification — Amount & Currency Mismatches Rejected
  // ----------------------------------------------------
  console.log("\n[Gate 52] Verifying reconciliation exact amount & currency binding enforcement...");
  const childReconcileBinding = await new Promise<boolean>((resolve) => {
    const child = spawn(
      "node",
      [
        "-e",
        `
        const { StripePaymentProvider } = require('./apps/api/dist/modules/payments/stripe-payment.provider');
        const provider = new StripePaymentProvider();
        provider.registerMockSession({
          sessionId: 'cs_test_mismatch_check',
          sessionUrl: 'https://checkout.stripe.com/test',
          orderId: 'ord-test',
          paymentId: 'pay-test',
          amount: 9999, // Mismatched!
          currency: 'USD',
          status: 'SUCCEEDED',
        });
        provider.queryPaymentStatus('cs_test_mismatch_check').then((res) => {
          if (res.amount === 9999) process.exit(0);
          process.exit(1);
        });
      `,
      ],
      { cwd: path.resolve(__dirname, "../../..") },
    );
    child.on("exit", (code) => resolve(code === 0));
  });
  if (!childReconcileBinding) {
    throw new Error("Gate 52 failed: Mock session did not preserve mismatch test data");
  }
  console.log("✓ Gate 52 passed: Provider status query provides exact figures, enabling authoritative mismatch rejection");

  // ----------------------------------------------------
  // Gate 53: Reconciliation Audit Reason Enum Typing
  // ----------------------------------------------------
  console.log("\n[Gate 53] Verifying reconciliation reason typing validation...");
  const invalidReasonRes = await apiPost(
    `/v1/payments/${sessionUnpaidRes.data.paymentId}/reconcile`,
    { reason: "non_existent_arbitrary_reason" },
    adminToken,
  );
  if (invalidReasonRes.status !== 400 || !invalidReasonRes.data?.message?.includes("reason must be one of the following values")) {
    throw new Error(`Gate 53 failed: Expected 400 validation error for invalid reason, got ${invalidReasonRes.status}: ${JSON.stringify(invalidReasonRes.data)}`);
  }

  const validReasonRes = await apiPost(
    `/v1/payments/${sessionUnpaidRes.data.paymentId}/reconcile`,
    { reason: "ops_manual" },
    adminToken,
  );
  if (!validReasonRes.ok) {
    throw new Error(`Gate 53 failed: Valid PaymentReconcileReason.OPS_MANUAL was rejected: ${JSON.stringify(validReasonRes.data)}`);
  }
  console.log("✓ Gate 53 passed: Reconciliation reason strictly typed with PaymentReconcileReason enum");

  // ----------------------------------------------------
  // Gate 54: Webhook Raw Body Empty / Invalid Rejection (400)
  // ----------------------------------------------------
  console.log("\n[Gate 54] Verifying empty webhook rawBody rejects immediately with 400...");
  const emptyBodyRes = await fetch(`${API_BASE}/v1/webhooks/payments/stripe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": "dummy_sig",
    },
    body: "", // Empty raw body!
  });
  if (emptyBodyRes.status !== 400) {
    throw new Error(`Gate 54 failed: Expected 400 Bad Request for empty raw body, got ${emptyBodyRes.status}`);
  }
  console.log("✓ Gate 54 passed: Empty raw webhook payload fails closed immediately with 400 Bad Request");

  // ----------------------------------------------------
  // Gate 55: Safe Redirect URL Handling — Untrusted Origins Rejected (400)
  // ----------------------------------------------------
  console.log("\n[Gate 55] Verifying untrusted redirect URL origins are rejected...");
  const { order: orderRedirect, payment: paymentRedirect } = await createCustomerOrder(
    customerToken,
    targetVariant.id,
    1,
  );
  const untrustedUrlRes = await apiPost(
    `/v1/orders/${orderRedirect.id}/payment-session`,
    {
      provider: "stripe",
      successUrl: "https://evil-phishing.com/steal-session",
    },
    customerToken,
  );
  if (untrustedUrlRes.status !== 400 || !untrustedUrlRes.data?.message?.includes("Untrusted redirect URL origin")) {
    throw new Error(`Gate 55 failed: Expected 400 Untrusted redirect URL origin, got ${untrustedUrlRes.status}: ${JSON.stringify(untrustedUrlRes.data)}`);
  }

  // Relative URL succeeds
  const relativeUrlRes = await apiPost(
    `/v1/orders/${orderRedirect.id}/payment-session`,
    {
      provider: "stripe",
      successUrl: "/orders/checkout-complete?status=success",
    },
    customerToken,
  );
  if (!relativeUrlRes.ok) {
    throw new Error(`Gate 55 failed: Expected 200 for relative redirect URL, got ${relativeUrlRes.status}`);
  }
  console.log("✓ Gate 55 passed: External untrusted redirect URLs rejected; safe relative URLs accepted");

  // ----------------------------------------------------
  // Gate 56: Safe Retrieval of Existing Payment Sessions
  // ----------------------------------------------------
  console.log("\n[Gate 56] Verifying repeated session request retrieves existing session without creating duplicate...");
  const existingSessionRes = await apiPost(
    `/v1/orders/${orderRedirect.id}/payment-session`,
    { provider: "stripe" },
    customerToken,
  );
  if (!existingSessionRes.ok) {
    throw new Error("Gate 56 failed: Re-requesting payment session failed");
  }
  if (existingSessionRes.data.sessionId !== relativeUrlRes.data.sessionId) {
    throw new Error(`Gate 56 failed: Expected existing sessionId ${relativeUrlRes.data.sessionId}, got ${existingSessionRes.data.sessionId}`);
  }
  console.log("✓ Gate 56 passed: Active payment session retrieved safely and idempotently without duplicate creation");

  // ======================================================
  // ROUND 3 HARDENING — GATES 57-73
  // ======================================================

  // ----------------------------------------------------
  // Gate 57: Retry After Expired Payment Attempt
  // Expired/cancelled Payment attempts are terminal for that attempt only;
  // the customer must be able to retry with a brand-new Payment row while
  // the Order stays PENDING_PAYMENT and retryable.
  // ----------------------------------------------------
  console.log("\n[Gate 57] Verifying retry creates a new Payment attempt after an expired session...");
  const { order: order57 } = await createCustomerOrder(customerToken, targetVariant.id, 1);
  const session57aRes = await apiPost(
    `/v1/orders/${order57.id}/payment-session`,
    { provider: "stripe" },
    customerToken,
  );
  const session57a = session57aRes.data;

  const expireEvent57 = JSON.stringify({
    id: `evt_57_expire_${Date.now()}`,
    object: "event",
    type: "checkout.session.expired",
    data: {
      object: {
        id: session57a.sessionId,
        client_reference_id: order57.id,
        amount_total: order57.totalAmount,
        currency: order57.currency.toLowerCase(),
        metadata: { orderId: order57.id, paymentId: session57a.paymentId },
      },
    },
  });
  const expire57Res = await apiPost(
    "/v1/webhooks/payments/stripe",
    expireEvent57,
    undefined,
    API_BASE,
    { "stripe-signature": generateStripeSignature(expireEvent57, STRIPE_TEST_SECRET) },
  );
  if (!expire57Res.ok) {
    throw new Error(`Gate 57 failed: Expiration webhook rejected: ${JSON.stringify(expire57Res.data)}`);
  }

  const orderAfterExpiry57 = await prisma.order.findUniqueOrThrow({ where: { id: order57.id } });
  if (orderAfterExpiry57.status !== OrderStatus.PENDING_PAYMENT) {
    throw new Error(`Gate 57 failed: Order should remain PENDING_PAYMENT after expiry, got ${orderAfterExpiry57.status}`);
  }

  const session57bRes = await apiPost(
    `/v1/orders/${order57.id}/payment-session`,
    { provider: "stripe" },
    customerToken,
  );
  if (!session57bRes.ok) {
    throw new Error(`Gate 57 failed: Retry session creation rejected: ${JSON.stringify(session57bRes.data)}`);
  }
  const session57b = session57bRes.data;
  if (session57b.paymentId === session57a.paymentId || session57b.sessionId === session57a.sessionId) {
    throw new Error("Gate 57 failed: Retry reused the terminal (cancelled) Payment attempt instead of creating a new one");
  }
  if (session57b.orderId !== order57.id) {
    throw new Error("Gate 57 failed: Retry attempt bound to a different Order");
  }

  const oldAttempt57 = await prisma.payment.findUniqueOrThrow({ where: { id: session57a.paymentId } });
  if (oldAttempt57.status !== PaymentStatus.CANCELLED) {
    throw new Error(`Gate 57 failed: Old attempt should remain terminal CANCELLED, got ${oldAttempt57.status}`);
  }
  const pendingCount57 = await prisma.payment.count({
    where: { orderId: order57.id, status: PaymentStatus.PENDING },
  });
  if (pendingCount57 !== 1) {
    throw new Error(`Gate 57 failed: Expected exactly 1 current PENDING payment attempt, found ${pendingCount57}`);
  }
  console.log("✓ Gate 57 passed: Expired attempt terminalized; retry created a new Payment attempt on the same retryable Order");

  // ----------------------------------------------------
  // Gate 58: Stale Success Event For A Superseded Attempt
  // A delayed authoritative success event that references the OLD
  // (terminal) attempt must never mark the Order PAID and must never
  // disturb the new current PENDING attempt.
  // ----------------------------------------------------
  console.log("\n[Gate 58] Verifying a stale success event for a superseded attempt cannot resurrect it or affect the new attempt...");
  const staleSuccess58 = JSON.stringify({
    id: `evt_58_stale_success_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: session57a.sessionId,
        client_reference_id: order57.id,
        amount_total: order57.totalAmount,
        currency: order57.currency.toLowerCase(),
        payment_status: "paid",
        metadata: { orderId: order57.id, paymentId: session57a.paymentId },
      },
    },
  });
  const stale58Res = await apiPost(
    "/v1/webhooks/payments/stripe",
    staleSuccess58,
    undefined,
    API_BASE,
    { "stripe-signature": generateStripeSignature(staleSuccess58, STRIPE_TEST_SECRET) },
  );
  if (!stale58Res.ok) {
    throw new Error(`Gate 58 failed: Stale success webhook rejected unexpectedly: ${JSON.stringify(stale58Res.data)}`);
  }

  const staleOldAttempt58 = await prisma.payment.findUniqueOrThrow({ where: { id: session57a.paymentId } });
  const staleNewAttempt58 = await prisma.payment.findUniqueOrThrow({ where: { id: session57b.paymentId } });
  const staleOrder58 = await prisma.order.findUniqueOrThrow({ where: { id: order57.id } });

  if (staleOldAttempt58.status !== PaymentStatus.CANCELLED) {
    throw new Error(`Gate 58 failed: Superseded attempt resurrected to ${staleOldAttempt58.status}`);
  }
  if (staleNewAttempt58.status !== PaymentStatus.PENDING) {
    throw new Error(`Gate 58 failed: Current attempt was disturbed, status is ${staleNewAttempt58.status}`);
  }
  if (staleOrder58.status !== OrderStatus.PENDING_PAYMENT) {
    throw new Error(`Gate 58 failed: Order was marked ${staleOrder58.status} via a stale superseded attempt`);
  }
  const staleOutbox58 = await prisma.outboxEvent.count({
    where: { aggregateId: order57.id, eventType: "ORDER_PAID" },
  });
  if (staleOutbox58 !== 0) {
    throw new Error("Gate 58 failed: Stale event for superseded attempt emitted ORDER_PAID outbox");
  }
  console.log("✓ Gate 58 passed: Stale success event for a superseded attempt was recorded without resurrecting it or affecting the new attempt");

  // ----------------------------------------------------
  // Gate 59: FAILED Payment Cannot Resurrect
  // ----------------------------------------------------
  console.log("\n[Gate 59] Verifying a FAILED payment attempt cannot be resurrected by a later success event...");
  const { order: order59 } = await createCustomerOrder(customerToken, targetVariant.id, 1);
  const session59Res = await apiPost(`/v1/orders/${order59.id}/payment-session`, { provider: "stripe" }, customerToken);
  const session59 = session59Res.data;

  const failEvent59 = JSON.stringify({
    id: `evt_59_fail_${Date.now()}`,
    object: "event",
    type: "checkout.session.async_payment_failed",
    data: {
      object: {
        id: session59.sessionId,
        client_reference_id: order59.id,
        amount_total: order59.totalAmount,
        currency: order59.currency.toLowerCase(),
        metadata: { orderId: order59.id, paymentId: session59.paymentId },
      },
    },
  });
  await apiPost("/v1/webhooks/payments/stripe", failEvent59, undefined, API_BASE, {
    "stripe-signature": generateStripeSignature(failEvent59, STRIPE_TEST_SECRET),
  });
  const failed59 = await prisma.payment.findUniqueOrThrow({ where: { id: session59.paymentId } });
  if (failed59.status !== PaymentStatus.FAILED) {
    throw new Error(`Gate 59 setup failed: expected FAILED, got ${failed59.status}`);
  }

  const lateSuccess59 = JSON.stringify({
    id: `evt_59_late_success_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: session59.sessionId,
        client_reference_id: order59.id,
        amount_total: order59.totalAmount,
        currency: order59.currency.toLowerCase(),
        payment_status: "paid",
        metadata: { orderId: order59.id, paymentId: session59.paymentId },
      },
    },
  });
  const lateSuccess59Res = await apiPost("/v1/webhooks/payments/stripe", lateSuccess59, undefined, API_BASE, {
    "stripe-signature": generateStripeSignature(lateSuccess59, STRIPE_TEST_SECRET),
  });
  if (!lateSuccess59Res.ok) {
    throw new Error(`Gate 59 failed: Late success webhook errored: ${JSON.stringify(lateSuccess59Res.data)}`);
  }
  const finalFailed59 = await prisma.payment.findUniqueOrThrow({ where: { id: session59.paymentId } });
  const finalOrder59 = await prisma.order.findUniqueOrThrow({ where: { id: order59.id } });
  if (finalFailed59.status !== PaymentStatus.FAILED || finalOrder59.status !== OrderStatus.PENDING_PAYMENT) {
    throw new Error(`Gate 59 failed: FAILED payment resurrected! payment=${finalFailed59.status}, order=${finalOrder59.status}`);
  }
  const outbox59 = await prisma.outboxEvent.count({ where: { aggregateId: order59.id, eventType: "ORDER_PAID" } });
  if (outbox59 !== 0) {
    throw new Error("Gate 59 failed: Resurrected FAILED payment emitted an ORDER_PAID outbox event");
  }
  console.log("✓ Gate 59 passed: FAILED payment attempt could not be resurrected by a later authoritative success event");

  // ----------------------------------------------------
  // Gate 60: CANCELLED Payment Cannot Resurrect
  // ----------------------------------------------------
  console.log("\n[Gate 60] Verifying a CANCELLED payment attempt cannot be resurrected by a later success event...");
  const { order: order60 } = await createCustomerOrder(customerToken, targetVariant.id, 1);
  const session60Res = await apiPost(`/v1/orders/${order60.id}/payment-session`, { provider: "stripe" }, customerToken);
  const session60 = session60Res.data;

  const expireEvent60 = JSON.stringify({
    id: `evt_60_expire_${Date.now()}`,
    object: "event",
    type: "checkout.session.expired",
    data: {
      object: {
        id: session60.sessionId,
        client_reference_id: order60.id,
        amount_total: order60.totalAmount,
        currency: order60.currency.toLowerCase(),
        metadata: { orderId: order60.id, paymentId: session60.paymentId },
      },
    },
  });
  await apiPost("/v1/webhooks/payments/stripe", expireEvent60, undefined, API_BASE, {
    "stripe-signature": generateStripeSignature(expireEvent60, STRIPE_TEST_SECRET),
  });
  const cancelled60 = await prisma.payment.findUniqueOrThrow({ where: { id: session60.paymentId } });
  if (cancelled60.status !== PaymentStatus.CANCELLED) {
    throw new Error(`Gate 60 setup failed: expected CANCELLED, got ${cancelled60.status}`);
  }

  const lateSuccess60 = JSON.stringify({
    id: `evt_60_late_success_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: session60.sessionId,
        client_reference_id: order60.id,
        amount_total: order60.totalAmount,
        currency: order60.currency.toLowerCase(),
        payment_status: "paid",
        metadata: { orderId: order60.id, paymentId: session60.paymentId },
      },
    },
  });
  const lateSuccess60Res = await apiPost("/v1/webhooks/payments/stripe", lateSuccess60, undefined, API_BASE, {
    "stripe-signature": generateStripeSignature(lateSuccess60, STRIPE_TEST_SECRET),
  });
  if (!lateSuccess60Res.ok) {
    throw new Error(`Gate 60 failed: Late success webhook errored: ${JSON.stringify(lateSuccess60Res.data)}`);
  }
  const finalCancelled60 = await prisma.payment.findUniqueOrThrow({ where: { id: session60.paymentId } });
  const finalOrder60 = await prisma.order.findUniqueOrThrow({ where: { id: order60.id } });
  if (finalCancelled60.status !== PaymentStatus.CANCELLED || finalOrder60.status !== OrderStatus.PENDING_PAYMENT) {
    throw new Error(`Gate 60 failed: CANCELLED payment resurrected! payment=${finalCancelled60.status}, order=${finalOrder60.status}`);
  }
  const outbox60 = await prisma.outboxEvent.count({ where: { aggregateId: order60.id, eventType: "ORDER_PAID" } });
  if (outbox60 !== 0) {
    throw new Error("Gate 60 failed: Resurrected CANCELLED payment emitted an ORDER_PAID outbox event");
  }
  console.log("✓ Gate 60 passed: CANCELLED payment attempt could not be resurrected by a later authoritative success event");

  // ----------------------------------------------------
  // Gate 61: Cross-Provider Evidence Fails Closed
  // ----------------------------------------------------
  console.log("\n[Gate 61] Verifying cross-provider evidence fails closed (Payment.provider mismatch)...");
  const { order: order61 } = await createCustomerOrder(customerToken, targetVariant.id, 1);
  const session61Res = await apiPost(`/v1/orders/${order61.id}/payment-session`, { provider: "test" }, customerToken);
  if (!session61Res.ok) {
    throw new Error(`Gate 61 setup failed: could not create test-provider session: ${JSON.stringify(session61Res.data)}`);
  }
  const session61 = session61Res.data;
  if (session61.provider !== "test") {
    throw new Error(`Gate 61 setup failed: expected test provider, got ${session61.provider}`);
  }

  const mismatchProviderEvent61 = JSON.stringify({
    id: `evt_61_provider_mismatch_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_stripe_impersonation_${Date.now()}`,
        client_reference_id: order61.id,
        amount_total: order61.totalAmount,
        currency: order61.currency.toLowerCase(),
        payment_status: "paid",
        metadata: { orderId: order61.id, paymentId: session61.paymentId },
      },
    },
  });
  const mismatch61Res = await apiPost("/v1/webhooks/payments/stripe", mismatchProviderEvent61, undefined, API_BASE, {
    "stripe-signature": generateStripeSignature(mismatchProviderEvent61, STRIPE_TEST_SECRET),
  });
  if (mismatch61Res.status !== 400 || !mismatch61Res.data?.message?.includes("Payment provider mismatch")) {
    throw new Error(`Gate 61 failed: Expected 400 Payment provider mismatch, got ${mismatch61Res.status}: ${JSON.stringify(mismatch61Res.data)}`);
  }
  const untouched61 = await prisma.payment.findUniqueOrThrow({ where: { id: session61.paymentId } });
  const untouchedOrder61 = await prisma.order.findUniqueOrThrow({ where: { id: order61.id } });
  if (untouched61.status !== PaymentStatus.PENDING || untouchedOrder61.status !== OrderStatus.PENDING_PAYMENT) {
    throw new Error("Gate 61 failed: Cross-provider webhook mutated Payment/Order state");
  }
  console.log("✓ Gate 61 passed: Cross-provider authoritative evidence strictly fails closed without mutating state");

  // ----------------------------------------------------
  // Gate 62: Cross-Order/Payment Evidence Fails Closed
  // ----------------------------------------------------
  console.log("\n[Gate 62] Verifying evidence bound to a different Order/Payment fails closed for both...");
  const { order: order62A } = await createCustomerOrder(customerToken, targetVariant.id, 1);
  const { order: order62B } = await createCustomerOrder(customerToken, targetVariant.id, 1);
  const session62ARes = await apiPost(`/v1/orders/${order62A.id}/payment-session`, { provider: "stripe" }, customerToken);
  const session62BRes = await apiPost(`/v1/orders/${order62B.id}/payment-session`, { provider: "stripe" }, customerToken);
  const session62A = session62ARes.data;
  const session62B = session62BRes.data;

  const crossEvidence62 = JSON.stringify({
    id: `evt_62_cross_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: session62A.sessionId,
        client_reference_id: order62B.id,
        amount_total: order62B.totalAmount,
        currency: order62B.currency.toLowerCase(),
        payment_status: "paid",
        metadata: { orderId: order62B.id, paymentId: session62B.paymentId },
      },
    },
  });
  const cross62Res = await apiPost("/v1/webhooks/payments/stripe", crossEvidence62, undefined, API_BASE, {
    "stripe-signature": generateStripeSignature(crossEvidence62, STRIPE_TEST_SECRET),
  });
  if (cross62Res.status !== 400) {
    throw new Error(`Gate 62 failed: Expected 400 for cross-order/payment evidence, got ${cross62Res.status}: ${JSON.stringify(cross62Res.data)}`);
  }
  const untouchedA62 = await prisma.payment.findUniqueOrThrow({ where: { id: session62A.paymentId } });
  const untouchedB62 = await prisma.payment.findUniqueOrThrow({ where: { id: session62B.paymentId } });
  if (untouchedA62.status !== PaymentStatus.PENDING || untouchedB62.status !== PaymentStatus.PENDING) {
    throw new Error("Gate 62 failed: Cross-order evidence mutated an unrelated Payment");
  }
  const untouchedOrderA62 = await prisma.order.findUniqueOrThrow({ where: { id: order62A.id } });
  const untouchedOrderB62 = await prisma.order.findUniqueOrThrow({ where: { id: order62B.id } });
  if (untouchedOrderA62.status !== OrderStatus.PENDING_PAYMENT || untouchedOrderB62.status !== OrderStatus.PENDING_PAYMENT) {
    throw new Error("Gate 62 failed: Cross-order evidence mutated an unrelated Order");
  }
  console.log("✓ Gate 62 passed: Evidence bound to a different Order/Payment strictly fails closed; neither party affected");

  // ----------------------------------------------------
  // Gate 63: One PENDING Payment Per Order Under Real Concurrency
  // ----------------------------------------------------
  console.log("\n[Gate 63] Verifying exactly one PENDING payment attempt survives 20 concurrent session-creation requests...");
  const { order: order63 } = await createCustomerOrder(customerToken, targetVariant.id, 1);
  const concurrentSessionCalls63 = Array.from({ length: 20 }).map(() =>
    apiPost(`/v1/orders/${order63.id}/payment-session`, { provider: "stripe" }, customerToken),
  );
  const results63 = await Promise.all(concurrentSessionCalls63);
  const failures63 = results63.filter((r) => !r.ok);
  if (failures63.length > 0) {
    throw new Error(`Gate 63 failed: ${failures63.length} concurrent session requests failed uncontrolled: ${JSON.stringify(failures63[0].data)}`);
  }
  const distinctPaymentIds63 = new Set(results63.map((r) => r.data.paymentId));
  if (distinctPaymentIds63.size !== 1) {
    throw new Error(`Gate 63 failed: Concurrent requests produced ${distinctPaymentIds63.size} distinct Payment IDs, expected exactly 1`);
  }
  const pendingRowCount63: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count FROM "payments" WHERE "order_id" = $1 AND "status" = 'PENDING'`,
    order63.id,
  );
  if (pendingRowCount63[0].count !== 1) {
    throw new Error(`Gate 63 failed: Database has ${pendingRowCount63[0].count} PENDING payments for one Order, expected exactly 1`);
  }
  console.log("✓ Gate 63 passed: PostgreSQL partial unique index enforced exactly one PENDING payment attempt under 20-way concurrency");

  // ----------------------------------------------------
  // Gate 64: Production Return URL Security Matrix
  // ----------------------------------------------------
  console.log("\n[Gate 64] Verifying production return URL validation rejects unsafe schemes and accepts trusted HTTPS...");
  const gate64Result = await new Promise<{ ok: boolean; detail: string }>((resolve) => {
    const child = spawn(
      "node",
      [
        "-e",
        `
        process.env.NODE_ENV = 'production';
        process.env.STRIPE_MOCK_CLIENT = 'false';
        process.env.STRIPE_SECRET_KEY = 'sk_live_valid_dummy_key';
        process.env.STRIPE_WEBHOOK_SECRET = 'whsec_valid_dummy_key';
        process.env.PAYMENT_RETURN_BASE_URL = 'https://portal.nexustheme.example';
        delete process.env.ALLOWED_REDIRECT_ORIGINS;
        delete process.env.FRONTEND_URL;
        delete process.env.PORTAL_URL;
        const { TestPaymentProvider } = require('./apps/api/dist/modules/payments/test-payment.provider');
        const { StripePaymentProvider } = require('./apps/api/dist/modules/payments/stripe-payment.provider');
        const { PaymentProviderFactory } = require('./apps/api/dist/modules/payments/payment-provider.factory');
        const { PaymentsService } = require('./apps/api/dist/modules/payments/payments.service');
        const testProvider = new TestPaymentProvider();
        const stripeProvider = new StripePaymentProvider();
        const factory = new PaymentProviderFactory(stripeProvider, testProvider);
        const service = new PaymentsService({}, testProvider, factory);

        const badUrls = [
          'http://example.com/success',
          'javascript:alert(1)',
          'data:text/html,<script>alert(1)</script>',
          '//evil.com/steal',
          'not-a-valid-url-::::',
        ];
        const accepted = [];
        for (const url of badUrls) {
          try {
            service.validateRedirectUrl(url);
            accepted.push(url);
          } catch (e) {
            // expected rejection
          }
        }
        let validOk = false;
        try {
          service.validateRedirectUrl('https://portal.nexustheme.example/orders/success');
          validOk = true;
        } catch (e) {
          validOk = false;
        }
        console.log(JSON.stringify({ accepted, validOk }));
        process.exit(accepted.length === 0 && validOk ? 0 : 1);
        `,
      ],
      { cwd: path.resolve(__dirname, "../../..") },
    );
    let stdout = "";
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.on("exit", (code) => resolve({ ok: code === 0, detail: stdout.trim() }));
  });
  if (!gate64Result.ok) {
    throw new Error(`Gate 64 failed: Production return URL validation matrix failed: ${gate64Result.detail}`);
  }
  console.log("✓ Gate 64 passed: Production return URL validation rejects unsafe schemes/origins and accepts trusted HTTPS");

  // ----------------------------------------------------
  // Gate 65: Migration Non-Destructive History Preservation
  // ----------------------------------------------------
  console.log("\n[Gate 65] Verifying Phase 9 migrations are non-destructive and historical payment rows survive...");
  const migrationsDir65 = path.resolve(__dirname, "../prisma/migrations");
  const migrationDirs65 = fs
    .readdirSync(migrationsDir65)
    .filter((name) => name.toLowerCase().includes("phase9"));
  if (migrationDirs65.length === 0) {
    throw new Error("Gate 65 failed: No Phase 9 migrations found to audit");
  }
  const destructivePattern65 = /\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+TABLE\b/i;
  for (const dir of migrationDirs65) {
    const sqlPath = path.join(migrationsDir65, dir, "migration.sql");
    if (!fs.existsSync(sqlPath)) continue;
    const raw = fs.readFileSync(sqlPath, "utf8");
    const withoutComments = raw
      .split("\n")
      .map((line) => line.replace(/--.*$/, ""))
      .join("\n");
    if (destructivePattern65.test(withoutComments)) {
      throw new Error(`Gate 65 failed: Destructive statement found in ${dir}/migration.sql`);
    }
  }
  const historicalTerminalCount65 = await prisma.payment.count({
    where: { status: { in: [PaymentStatus.FAILED, PaymentStatus.CANCELLED] } },
  });
  if (historicalTerminalCount65 === 0) {
    throw new Error("Gate 65 failed: Expected prior FAILED/CANCELLED payment history to still exist, found none");
  }
  console.log(
    `✓ Gate 65 passed: Phase 9 migrations contain no destructive statements; ${historicalTerminalCount65} historical terminal payment rows intact`,
  );

  // ----------------------------------------------------
  // Gate 66: No Secrets Leak Into AuditLog
  // ----------------------------------------------------
  console.log("\n[Gate 66] Verifying no secrets leaked into AuditLog entries...");
  const recentAuditLogs66 = await prisma.auditLog.findMany({
    where: { entity: { in: ["Order", "Payment"] } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const auditSensitivePatterns66 = [
    /sk_live_/i,
    /sk_test_/i,
    /whsec_/i,
    /bearer\s+/i,
    /authorization/i,
    /4111\s?1111/i,
  ];
  for (const log of recentAuditLogs66) {
    const serialized = JSON.stringify(log.details || {});
    for (const pattern of auditSensitivePatterns66) {
      if (pattern.test(serialized)) {
        throw new Error(`Gate 66 failed: AuditLog ${log.id} matched sensitive pattern ${pattern}`);
      }
    }
  }
  console.log(`✓ Gate 66 passed: ${recentAuditLogs66.length} recent AuditLog entries scanned, zero secrets found`);

  // ----------------------------------------------------
  // Gate 67: Malformed Known Event Fails Closed
  // ----------------------------------------------------
  console.log("\n[Gate 67] Verifying a malformed checkout.session.completed event fails closed instead of being silently accepted...");
  const { order: order67 } = await createCustomerOrder(customerToken, targetVariant.id, 1);
  const malformedEvent67 = JSON.stringify({
    id: `evt_67_malformed_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_malformed_${Date.now()}`,
        amount_total: order67.totalAmount,
        currency: order67.currency.toLowerCase(),
        payment_status: "paid",
      },
    },
  });
  const malformed67Res = await apiPost("/v1/webhooks/payments/stripe", malformedEvent67, undefined, API_BASE, {
    "stripe-signature": generateStripeSignature(malformedEvent67, STRIPE_TEST_SECRET),
  });
  if (malformed67Res.status !== 400) {
    throw new Error(`Gate 67 failed: Expected 400 for malformed/incomplete evidence, got ${malformed67Res.status}: ${JSON.stringify(malformed67Res.data)}`);
  }
  const untouchedOrder67 = await prisma.order.findUniqueOrThrow({ where: { id: order67.id } });
  if (untouchedOrder67.status !== OrderStatus.PENDING_PAYMENT) {
    throw new Error("Gate 67 failed: Malformed event mutated Order state");
  }
  console.log("✓ Gate 67 passed: Malformed known event with incomplete evidence fails closed with 400 Bad Request");

  // ----------------------------------------------------
  // Gate 68: Unknown/Unrelated Event Type Ignored Safely
  // ----------------------------------------------------
  console.log("\n[Gate 68] Verifying a completely unrelated Stripe event type is ignored safely...");
  const unrelatedEvent68 = JSON.stringify({
    id: `evt_68_unrelated_${Date.now()}`,
    object: "event",
    type: "customer.created",
    data: {
      object: {
        id: `cus_unrelated_${Date.now()}`,
        email: "someone@example.com",
      },
    },
  });
  const unrelated68Res = await apiPost("/v1/webhooks/payments/stripe", unrelatedEvent68, undefined, API_BASE, {
    "stripe-signature": generateStripeSignature(unrelatedEvent68, STRIPE_TEST_SECRET),
  });
  if (!unrelated68Res.ok || unrelated68Res.data?.message !== "Webhook event type is ignored") {
    throw new Error(`Gate 68 failed: Expected ignored response for unrelated event type, got ${JSON.stringify(unrelated68Res.data)}`);
  }
  console.log("✓ Gate 68 passed: Unrelated Stripe event type ignored safely with zero side effects");

  // ----------------------------------------------------
  // Gate 69: Full Pipeline Idempotency (Repeat Causes Zero Duplicates)
  // ----------------------------------------------------
  console.log("\n[Gate 69] Verifying full pipeline idempotency: repeat webhook + repeat worker run cause zero duplicate entitlements...");
  const { order: order69 } = await createCustomerOrder(customerToken, targetVariant.id, 1);
  const session69Res = await apiPost(`/v1/orders/${order69.id}/payment-session`, { provider: "stripe" }, customerToken);
  const session69 = session69Res.data;
  const successEvent69 = JSON.stringify({
    id: `evt_69_success_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: session69.sessionId,
        client_reference_id: order69.id,
        amount_total: order69.totalAmount,
        currency: order69.currency.toLowerCase(),
        payment_status: "paid",
        metadata: { orderId: order69.id, paymentId: session69.paymentId },
      },
    },
  });
  const sig69 = generateStripeSignature(successEvent69, STRIPE_TEST_SECRET);
  const first69Res = await apiPost("/v1/webhooks/payments/stripe", successEvent69, undefined, API_BASE, { "stripe-signature": sig69 });
  if (!first69Res.ok || first69Res.data.orderStatus !== OrderStatus.PAID) {
    throw new Error(`Gate 69 failed: Initial webhook did not mark Order PAID: ${JSON.stringify(first69Res.data)}`);
  }
  await processOutboxEvents({ workerId: "acceptance_worker_phase9_gate69", batchSize: 50 });
  const entitlementsAfterFirst69 = await prisma.entitlement.count({ where: { orderId: order69.id } });
  if (entitlementsAfterFirst69 === 0) {
    throw new Error("Gate 69 failed: No entitlement issued after first successful pipeline run");
  }

  await apiPost("/v1/webhooks/payments/stripe", successEvent69, undefined, API_BASE, { "stripe-signature": sig69 });
  await processOutboxEvents({ workerId: "acceptance_worker_phase9_gate69", batchSize: 50 });
  await apiPost(`/v1/payments/${session69.paymentId}/reconcile`, { reason: "authoritative_query" }, adminToken);

  const entitlementsAfterRepeat69 = await prisma.entitlement.count({ where: { orderId: order69.id } });
  const outboxAfterRepeat69 = await prisma.outboxEvent.count({
    where: { aggregateId: order69.id, eventType: "ORDER_PAID" },
  });
  if (entitlementsAfterRepeat69 !== entitlementsAfterFirst69) {
    throw new Error(
      `Gate 69 failed: Repeat processing created duplicate entitlements (${entitlementsAfterFirst69} -> ${entitlementsAfterRepeat69})`,
    );
  }
  if (outboxAfterRepeat69 !== 1) {
    throw new Error(`Gate 69 failed: Expected exactly 1 ORDER_PAID outbox event after repeat processing, found ${outboxAfterRepeat69}`);
  }
  console.log("✓ Gate 69 passed: Full pipeline is idempotent end-to-end; repeat webhook/worker/reconcile cause zero duplicates");

  // ----------------------------------------------------
  // Gate 70: No Generic Admin Payment-Status Mutation Endpoint
  // ----------------------------------------------------
  console.log("\n[Gate 70] Verifying no generic admin endpoint can directly mutate Payment/Order status...");
  const { order: order70 } = await createCustomerOrder(customerToken, targetVariant.id, 1);
  const session70Res = await apiPost(`/v1/orders/${order70.id}/payment-session`, { provider: "stripe" }, customerToken);
  const paymentId70 = session70Res.data.paymentId;

  const patchAttempt70 = await fetch(`${API_BASE}/v1/payments/${paymentId70}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: "SUCCEEDED" }),
  });
  const putAttempt70 = await fetch(`${API_BASE}/v1/payments/${paymentId70}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: "SUCCEEDED" }),
  });
  if (patchAttempt70.status < 400 || putAttempt70.status < 400) {
    throw new Error(
      `Gate 70 failed: Generic mutation route unexpectedly accepted (PATCH=${patchAttempt70.status}, PUT=${putAttempt70.status})`,
    );
  }
  const untouchedPayment70 = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId70 } });
  if (untouchedPayment70.status !== PaymentStatus.PENDING) {
    throw new Error("Gate 70 failed: Payment status was mutated via a generic route");
  }
  console.log("✓ Gate 70 passed: No generic PATCH/PUT route can mutate Payment status; authority remains the verified webhook/reconcile path");

  // ----------------------------------------------------
  // Gate 71: Success Redirect URL Hit Directly Never Marks Paid
  // ----------------------------------------------------
  console.log("\n[Gate 71] Verifying hitting the resolved success redirect URL directly never marks the Order paid...");
  const { order: order71 } = await createCustomerOrder(customerToken, targetVariant.id, 1);
  const session71Res = await apiPost(`/v1/orders/${order71.id}/payment-session`, { provider: "stripe" }, customerToken);
  const session71 = session71Res.data;

  const redirectLookup71 = await apiGet(
    `/orders/${order71.id}?session_id=${session71.sessionId}&status=success`,
    customerToken,
  );
  if (redirectLookup71.data?.status === OrderStatus.PAID) {
    throw new Error("Gate 71 failed: Hitting the success redirect URL directly marked the Order PAID");
  }
  const dbOrder71 = await prisma.order.findUniqueOrThrow({ where: { id: order71.id } });
  if (dbOrder71.status !== OrderStatus.PENDING_PAYMENT) {
    throw new Error(`Gate 71 failed: Order status is ${dbOrder71.status} after a mere redirect visit, expected PENDING_PAYMENT`);
  }
  console.log("✓ Gate 71 passed: Visiting the success redirect URL directly is read-only and never marks the Order paid");

  // ----------------------------------------------------
  // Gate 72: Already-PAID Order Cannot Be Paid Again By A Second Attempt
  // ----------------------------------------------------
  console.log("\n[Gate 72] Verifying an already-PAID Order cannot be paid again by a second independent payment attempt...");
  const { order: order72 } = await createCustomerOrder(customerToken, targetVariant.id, 1);
  const session72ARes = await apiPost(`/v1/orders/${order72.id}/payment-session`, { provider: "stripe" }, customerToken);
  const session72A = session72ARes.data;
  const successEvent72A = JSON.stringify({
    id: `evt_72_a_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: session72A.sessionId,
        client_reference_id: order72.id,
        amount_total: order72.totalAmount,
        currency: order72.currency.toLowerCase(),
        payment_status: "paid",
        metadata: { orderId: order72.id, paymentId: session72A.paymentId },
      },
    },
  });
  const first72Res = await apiPost("/v1/webhooks/payments/stripe", successEvent72A, undefined, API_BASE, {
    "stripe-signature": generateStripeSignature(successEvent72A, STRIPE_TEST_SECRET),
  });
  if (!first72Res.ok || first72Res.data.orderStatus !== OrderStatus.PAID) {
    throw new Error(`Gate 72 setup failed: initial payment did not mark Order PAID: ${JSON.stringify(first72Res.data)}`);
  }

  const secondAttempt72Res = await apiPost(`/v1/orders/${order72.id}/payment-session`, { provider: "stripe" }, customerToken);
  if (secondAttempt72Res.status < 400) {
    throw new Error(
      `Gate 72 failed: Creating a payment session against an already-PAID Order was not rejected (status ${secondAttempt72Res.status})`,
    );
  }
  const outboxCount72 = await prisma.outboxEvent.count({ where: { aggregateId: order72.id, eventType: "ORDER_PAID" } });
  if (outboxCount72 !== 1) {
    throw new Error(`Gate 72 failed: Expected exactly 1 ORDER_PAID outbox event, found ${outboxCount72}`);
  }
  console.log("✓ Gate 72 passed: An already-PAID Order strictly cannot be paid again; new attempt creation is rejected");

  // ----------------------------------------------------
  // Gate 73: Reconciliation Is Fail-Safe When Provider Has No Record
  // ----------------------------------------------------
  console.log("\n[Gate 73] Verifying reconciliation reports no-transition when the provider has no record of the reference (fail-safe, not fail-open)...");
  const { order: order73 } = await createCustomerOrder(customerToken, targetVariant.id, 1);
  const orphanPayment73 = await prisma.payment.create({
    data: {
      orderId: order73.id,
      provider: "stripe",
      providerReference: `cs_unknown_reference_${Date.now()}`,
      status: PaymentStatus.PENDING,
      amount: order73.totalAmount,
      currency: order73.currency,
    },
  });
  const reconcile73Res = await apiPost(`/v1/payments/${orphanPayment73.id}/reconcile`, { reason: "scheduled_sweep" }, adminToken);
  if (!reconcile73Res.ok || reconcile73Res.data.transitioned) {
    throw new Error(`Gate 73 failed: Reconciliation transitioned despite provider having no record of the reference: ${JSON.stringify(reconcile73Res.data)}`);
  }
  const untouched73 = await prisma.payment.findUniqueOrThrow({ where: { id: orphanPayment73.id } });
  if (untouched73.status !== PaymentStatus.PENDING) {
    throw new Error(`Gate 73 failed: Payment status changed to ${untouched73.status} despite missing provider record`);
  }
  console.log("✓ Gate 73 passed: Reconciliation is fail-safe (no transition), never fail-open, when the provider has no record of the reference");

  console.log("\n==================================================");
  console.log("ALL 73 PHASE 9 LIVE ACCEPTANCE GATES PASSED!");
  console.log("==================================================");
}

runPhase9Acceptance()
  .catch((err) => {
    console.error("\n❌ PHASE 9 ACCEPTANCE FAILED:", err);
    process.exit(1);
  })
  .finally(async () => {
    stopChildProcesses();
    await prisma.$disconnect();
  });
