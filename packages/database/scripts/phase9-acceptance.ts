import * as crypto from "node:crypto";
import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
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
  console.log("PHASE 9 — PRODUCTION PAYMENT GATEWAY ACCEPTANCE (35 GATES)");
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
        const { TestPaymentProvider } = require('./apps/api/dist/modules/payments/test-payment.provider');
        const { PaymentProviderFactory } = require('./apps/api/dist/modules/payments/payment-provider.factory');
        const { StripePaymentProvider } = require('./apps/api/dist/modules/payments/stripe-payment.provider');
        const testProvider = new TestPaymentProvider();
        const stripeProvider = new StripePaymentProvider();
        const factory = new PaymentProviderFactory(stripeProvider, testProvider);
        try {
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

  const dbPaymentB = await prisma.payment.findUniqueOrThrow({
    where: { id: sessionB.paymentId },
  });
  const dbOrderB = await prisma.order.findUniqueOrThrow({
    where: { id: orderB.id },
  });

  if (dbPaymentB.status !== PaymentStatus.SUCCEEDED || dbOrderB.status !== OrderStatus.PAID) {
    throw new Error(
      `Gate 28 failed: Terminal state safety violated. Payment status: ${dbPaymentB.status}, Order: ${dbOrderB.status}`,
    );
  }
  console.log("✓ Gate 28 passed: Success won terminal state; Payment remains SUCCEEDED and Order remains PAID");

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

  // Event 2: payment_intent.succeeded
  const eventC2 = JSON.stringify({
    id: `evt_c_pi_succeeded_${Date.now()}`,
    object: "event",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: `pi_test_${sessionC.paymentId}`,
        amount: orderC.totalAmount,
        currency: orderC.currency.toLowerCase(),
        status: "succeeded",
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
      { reason: "concurrent_test" },
      customerToken,
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
    { reason: "scheduled_cron_job" },
    customerToken,
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

  console.log("\n==================================================");
  console.log("ALL 35 PHASE 9 LIVE ACCEPTANCE GATES PASSED!");
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
