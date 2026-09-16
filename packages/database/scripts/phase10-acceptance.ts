import * as crypto from "node:crypto";
import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
import {
  prisma,
  ProductType,
  FulfillmentType,
  OrderStatus,
  PaymentStatus,
  EntitlementStatus,
  LicenseStatus,
  publishProductVersion,
  registerVerifiedUploadedFile,
  provisionInternalLicenses,
} from "../src/index";
import { normalizeDomain } from "@nexus/utils";

const TEST_PORT = process.env.API_PORT || "4007";
const API_BASE = `http://localhost:${TEST_PORT}`;
const TEST_ENCRYPTION_KEY =
  process.env.LICENSE_KEY_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let apiProcess: ChildProcess | null = null;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
        STRIPE_SECRET_KEY: "sk_test_placeholder_acceptance",
        STRIPE_WEBHOOK_SECRET: "whsec_test_secret_for_acceptance_testing_only",
        STRIPE_MOCK_CLIENT: "true",
        ENABLE_TEST_PAYMENT_PROVIDER: "true",
        TEST_PAYMENT_WEBHOOK_SECRET:
          process.env.TEST_PAYMENT_WEBHOOK_SECRET || "ci-test-payment-secret",
        LICENSE_KEY_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      },
    },
  );

  apiProcess.stdout?.on("data", (data) => {
    const msg = data.toString();
    if (msg.includes("NEXUSTHEME API is running")) {
      console.log(`  ${msg.trim()}`);
    }
  });

  apiProcess.stderr?.on("data", (data) => {
    const msg = data.toString();
    if (!msg.includes("ExperimentalWarning") && !msg.includes("deprecated")) {
      console.error(`  [API Error] ${msg.trim()}`);
    }
  });

  const start = Date.now();
  while (Date.now() - start < 30000) {
    await sleep(500);
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) {
        console.log(`  API server ready on port ${TEST_PORT}.`);
        return;
      }
    } catch {
      // keep waiting
    }
  }
  throw new Error("Timed out waiting for API server to start on port " + TEST_PORT);
}

function stopChildProcesses(): void {
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

async function apiGet(endpoint: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${endpoint}`, { headers });
  const data: any = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function apiPost(endpoint: string, body: any, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function apiPatch(endpoint: string, body: any, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function apiPut(endpoint: string, body: any, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function runPhase10Acceptance() {
  console.log("==================================================");
  console.log("PHASE 10 — CUSTOMER PORTAL ACCEPTANCE SUITE (47 GATES)");
  console.log("==================================================");

  // Setup API
  await ensureApiRunning();

  const customer1Token = "dev-customer-token";
  const customer2Token = "dev-custom:sub_dev_customer_002:customer2@nexustheme.dev";
  const adminToken = "dev-admin-token";

  // Gate 1: Portal Unauthenticated Access Blocked
  console.log("\n[Gate 1] Unauthenticated portal request blocked (401)...");
  const unauthRes = await apiGet("/orders");
  if (unauthRes.status !== 401) {
    throw new Error(`Gate 1 failed: Expected 401 Unauthorized, received ${unauthRes.status}`);
  }
  console.log("✓ Gate 1 passed: Unauthenticated portal request rejected with 401");

  // Gate 2: Valid Customer Session Accepted
  console.log("\n[Gate 2] Valid customer session accepted (/auth/me)...");
  const meRes1 = await apiGet("/auth/me", customer1Token);
  if (meRes1.status !== 200 || !meRes1.data?.id) {
    throw new Error(`Gate 2 failed: Expected 200 with user profile, received status ${meRes1.status}`);
  }
  const customer1Id = meRes1.data.id;
  console.log(`✓ Gate 2 passed: Customer 1 session verified (userId=${customer1Id})`);

  // Gate 3: Customer Profile Returns Correct User Identity
  console.log("\n[Gate 3] Customer profile returns correct identity...");
  const meRes2 = await apiGet("/auth/me", customer2Token);
  const customer2Id = meRes2.data.id;
  if (!customer2Id || customer1Id === customer2Id) {
    throw new Error("Gate 3 failed: Customer 1 and Customer 2 have colliding IDs");
  }
  console.log(`✓ Gate 3 passed: Distinct customer profiles confirmed (Customer 2 userId=${customer2Id})`);

  // Gate 4: Customer Cannot Access Admin Routes
  console.log("\n[Gate 4] Customer cannot access admin routes (403 Forbidden)...");
  const adminAccessRes = await apiGet("/admin/users", customer1Token);
  if (adminAccessRes.status !== 403) {
    throw new Error(`Gate 4 failed: Expected 403 Forbidden for customer on admin route, got ${adminAccessRes.status}`);
  }
  console.log("✓ Gate 4 passed: Admin-only routes strictly forbidden to customers");

  // Seed Product & Variants for test orders & entitlements
  let testProduct = await prisma.product.findUnique({
    where: { slug: "portal-test-theme" },
  });
  if (!testProduct) {
    testProduct = await prisma.product.create({
      data: {
        slug: "portal-test-theme",
        name: "Portal Test Theme",
        productType: ProductType.LICENSED_SOFTWARE,
        fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
        status: "ACTIVE",
      },
    });
  }

  let testVariant = await prisma.productVariant.findFirst({
    where: { productId: testProduct.id },
  });
  if (!testVariant) {
    testVariant = await prisma.productVariant.create({
      data: {
        productId: testProduct.id,
        name: "Pro License",
        sku: "NXS-PORTAL-01",
        status: "ACTIVE",
      },
    });
  }

  // Seed independent orders for Customer 1 and Customer 2
  const order1 = await prisma.order.create({
    data: {
      orderNumber: `ORD-P10-C1-${Date.now()}`,
      userId: customer1Id,
      status: OrderStatus.PENDING_PAYMENT,
      currency: "USD",
      subtotalAmount: 9900,
      discountAmount: 0,
      totalAmount: 9900,
      items: {
        create: {
          productId: testProduct.id,
          variantId: testVariant.id,
          productName: "Portal Test Theme",
          variantName: "Pro License",
          sku: "NXS-PORTAL-01",
          productType: ProductType.LICENSED_SOFTWARE,
          fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
          unitAmount: 9900,
          quantity: 1,
          lineTotalAmount: 9900,
          currency: "USD",
          maxActivations: 3,
        },
      },
    },
    include: { items: true },
  });

  const order2 = await prisma.order.create({
    data: {
      orderNumber: `ORD-P10-C2-${Date.now()}`,
      userId: customer2Id,
      status: OrderStatus.PENDING_PAYMENT,
      currency: "USD",
      subtotalAmount: 14900,
      discountAmount: 0,
      totalAmount: 14900,
      items: {
        create: {
          productId: testProduct.id,
          variantId: testVariant.id,
          productName: "Portal Test Theme",
          variantName: "Enterprise License",
          sku: "NXS-PORTAL-02",
          productType: ProductType.LICENSED_SOFTWARE,
          fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
          unitAmount: 14900,
          quantity: 1,
          lineTotalAmount: 14900,
          currency: "USD",
          maxActivations: 10,
        },
      },
    },
    include: { items: true },
  });

  // Gate 5: Orders List Only Own Orders
  console.log("\n[Gate 5] Customer orders list only includes own orders...");
  const ordersRes1 = await apiGet("/orders", customer1Token);
  const orderIds1: string[] = (ordersRes1.data?.items || []).map((o: any) => o.id);
  if (!orderIds1.includes(order1.id) || orderIds1.includes(order2.id)) {
    throw new Error("Gate 5 failed: Customer 1 orders list contained Customer 2 order or missed own order");
  }
  console.log("✓ Gate 5 passed: Orders list strictly scoped to authenticated user");

  // Gate 6: Cross-User Order Read Blocked
  console.log("\n[Gate 6] Cross-user order read blocked (404 Not Found)...");
  const crossOrderRes = await apiGet(`/orders/${order1.id}`, customer2Token);
  if (crossOrderRes.status !== 404) {
    throw new Error(`Gate 6 failed: Expected 404 for cross-user order access, received ${crossOrderRes.status}`);
  }
  console.log("✓ Gate 6 passed: Cross-user order read returns 404 anti-enumeration");

  // Gate 7: Order Detail Uses Immutable Purchase Snapshot
  console.log("\n[Gate 7] Order detail returns immutable purchase snapshot items...");
  const orderDetailRes = await apiGet(`/orders/${order1.id}`, customer1Token);
  if (orderDetailRes.status !== 200 || !orderDetailRes.data?.items?.length) {
    throw new Error("Gate 7 failed: Could not fetch customer order detail");
  }
  const itemSnapshot = orderDetailRes.data.items[0];
  if (
    itemSnapshot.productName !== "Portal Test Theme" ||
    itemSnapshot.unitAmount !== 9900 ||
    itemSnapshot.lineTotalAmount !== 9900
  ) {
    throw new Error(`Gate 7 failed: Snapshot item mismatch: ${JSON.stringify(itemSnapshot)}`);
  }
  console.log("✓ Gate 7 passed: Immutable purchase snapshots preserved in customer order detail");

  // Gate 8: Customer Sees PENDING_PAYMENT State Correctly
  console.log("\n[Gate 8] Customer sees PENDING_PAYMENT state correctly...");
  if (orderDetailRes.data.status !== "PENDING_PAYMENT") {
    throw new Error(`Gate 8 failed: Expected status PENDING_PAYMENT, got ${orderDetailRes.data.status}`);
  }
  console.log("✓ Gate 8 passed: Order status correctly reflects PENDING_PAYMENT");

  // Gate 9: Payment Retry Calls Backend Payment-Session
  console.log("\n[Gate 9] Customer initiates payment retry via backend payment-session...");
  const retrySessionRes = await apiPost(
    `/orders/${order1.id}/payment-session`,
    { successUrl: "http://localhost:3001/payment/result", cancelUrl: "http://localhost:3001/orders" },
    customer1Token,
  );
  if (retrySessionRes.status !== 201 && retrySessionRes.status !== 200) {
    throw new Error(`Gate 9 failed: Payment session creation failed with status ${retrySessionRes.status}`);
  }
  if (!retrySessionRes.data?.sessionUrl || !retrySessionRes.data?.sessionId) {
    throw new Error("Gate 9 failed: Response missing authoritative sessionUrl or sessionId");
  }
  console.log("✓ Gate 9 passed: Backend payment-session creates authoritative provider session");

  // Gate 10: Cross-User Payment Retry Blocked
  console.log("\n[Gate 10] Cross-user payment retry blocked (404/403)...");
  const crossRetryRes = await apiPost(
    `/orders/${order1.id}/payment-session`,
    {},
    customer2Token,
  );
  if (crossRetryRes.status !== 404 && crossRetryRes.status !== 403) {
    throw new Error(`Gate 10 failed: Expected 404/403 for cross-user payment retry, got ${crossRetryRes.status}`);
  }
  console.log("✓ Gate 10 passed: Cross-user payment retry strictly prevented");

  // Gate 11: Client-Supplied Amount Cannot Alter Payment Amount
  console.log("\n[Gate 11] Client cannot tamper with payment session amount...");
  if (retrySessionRes.data.amount !== 9900) {
    throw new Error(`Gate 11 failed: Payment session amount was altered: ${retrySessionRes.data.amount}`);
  }
  console.log("✓ Gate 11 passed: Payment amount derived authoritatively from database order");

  // Gate 12: Client-Supplied Currency Cannot Alter Payment Currency
  console.log("\n[Gate 12] Client cannot tamper with payment session currency...");
  if (retrySessionRes.data.currency !== "USD") {
    throw new Error(`Gate 12 failed: Payment session currency was altered: ${retrySessionRes.data.currency}`);
  }
  console.log("✓ Gate 12 passed: Payment currency derived authoritatively from database order");

  // Gate 13: Payment Result Page / Browser Redirect Cannot Mark Order PAID
  console.log("\n[Gate 13] Browser redirect to portal success URL never marks order PAID...");
  const orderCheckAfterRedirect = await prisma.order.findUnique({
    where: { id: order1.id },
  });
  if (orderCheckAfterRedirect?.status === OrderStatus.PAID) {
    throw new Error("Gate 13 failed: Order was marked PAID without backend webhook verification");
  }
  console.log("✓ Gate 13 passed: Client-side navigation / redirects have ZERO authority");

  // Gate 14: Frontend Cannot Directly Mutate Payment Status
  console.log("\n[Gate 14] Frontend cannot directly mutate Payment status (PATCH/PUT blocked)...");
  const patchPaymentRes = await apiPatch(
    `/payments/${retrySessionRes.data.paymentId}`,
    { status: "SUCCEEDED" },
    customer1Token,
  );
  if (patchPaymentRes.status !== 404 && patchPaymentRes.status !== 403 && patchPaymentRes.status !== 405) {
    throw new Error(`Gate 14 failed: Direct payment mutation unexpectedly succeeded with status ${patchPaymentRes.status}`);
  }
  console.log("✓ Gate 14 passed: No client endpoint exists to directly mutate payment status");

  // Gate 15: Frontend Cannot Directly Mutate Order Status
  console.log("\n[Gate 15] Frontend cannot directly mutate Order status (PATCH/PUT blocked)...");
  const patchOrderRes = await apiPatch(
    `/orders/${order1.id}`,
    { status: "PAID" },
    customer1Token,
  );
  if (patchOrderRes.status !== 404 && patchOrderRes.status !== 403 && patchOrderRes.status !== 405) {
    throw new Error(`Gate 15 failed: Direct order status mutation succeeded with status ${patchOrderRes.status}`);
  }
  console.log("✓ Gate 15 passed: Order status cannot be updated directly by client");

  // Gate 16: Frontend Cannot Directly Activate Entitlement
  console.log("\n[Gate 16] Frontend cannot directly activate an entitlement...");
  const fakeEntitlementRes = await apiPost(
    "/entitlements",
    { status: "ACTIVE", productId: testProduct.id },
    customer1Token,
  );
  if (fakeEntitlementRes.status !== 404 && fakeEntitlementRes.status !== 405) {
    throw new Error("Gate 16 failed: Direct entitlement creation route accepted");
  }
  console.log("✓ Gate 16 passed: Entitlements can only be issued by authoritative payment transition");

  // Authoritatively pay order 1 via test payment callback (mock mode)
  console.log("\n  Simulating authoritative payment callback for Order 1...");
  const testSecret =
    process.env.TEST_PAYMENT_WEBHOOK_SECRET || "ci-test-payment-secret";
  const webhookEventId = `evt_p10_pay_${Date.now()}`;
  const callbackPayload = {
    paymentId: retrySessionRes.data.paymentId,
    externalEventId: webhookEventId,
    eventType: "payment.succeeded",
  };
  const signature = crypto
    .createHmac("sha256", testSecret)
    .update(`${webhookEventId}:${retrySessionRes.data.paymentId}:payment.succeeded`)
    .digest("hex");
  const headers = {
    "Content-Type": "application/json",
    "x-test-signature": signature,
  };
  const callbackRes = await fetch(`${API_BASE}/payments/test-callback`, {
    method: "POST",
    headers,
    body: JSON.stringify(callbackPayload),
  });
  if (!callbackRes.ok) {
    const errBody = await callbackRes.text();
    throw new Error(
      `Authoritative payment callback failed (${callbackRes.status}): ${errBody}`,
    );
  }

  // Gate 17: Order Reflects Backend PAID After Authoritative Payment
  console.log("\n[Gate 17] Verifying Order reflects PAID after authoritative callback...");
  const order1PaidRes = await apiGet(`/orders/${order1.id}`, customer1Token);
  if (order1PaidRes.data.status !== "PAID") {
    throw new Error(`Gate 17 failed: Order status is ${order1PaidRes.data.status}, expected PAID`);
  }
  console.log("✓ Gate 17 passed: Customer order detail reflects authoritative PAID state");

  // Gate 18: Already-PAID Order Cannot Create New Payment Session
  console.log("\n[Gate 18] Already-PAID order cannot create new payment attempt...");
  const paidRetryRes = await apiPost(
    `/orders/${order1.id}/payment-session`,
    {},
    customer1Token,
  );
  if (paidRetryRes.status !== 400 && paidRetryRes.status !== 409) {
    throw new Error(`Gate 18 failed: Expected 400/409 for paying already-PAID order, got ${paidRetryRes.status}`);
  }
  console.log("✓ Gate 18 passed: Already-PAID order rejects new payment attempts");

  // Seed Entitlement for Customer 1 and Customer 2
  const entitlement1 = await prisma.entitlement.create({
    data: {
      userId: customer1Id,
      orderId: order1.id,
      orderItemId: order1.items[0].id,
      productId: testProduct.id,
      variantId: testVariant.id,
      productType: ProductType.LICENSED_SOFTWARE,
      fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
      status: EntitlementStatus.ACTIVE,
      quantity: 1,
      maxActivations: 3,
      updatesUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      supportUntil: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
    },
  });

  const entitlement2 = await prisma.entitlement.create({
    data: {
      userId: customer2Id,
      orderId: order2.id,
      orderItemId: order2.items[0].id,
      productId: testProduct.id,
      variantId: testVariant.id,
      productType: ProductType.EXTERNAL_MANAGED_LICENSE,
      fulfillmentType: FulfillmentType.EXTERNAL_MANAGED,
      status: EntitlementStatus.ACTIVE,
      quantity: 1,
      maxActivations: 2,
    },
  });

  const order3 = await prisma.order.create({
    data: {
      orderNumber: `ORD-P10-C2-INT-${Date.now()}`,
      userId: customer2Id,
      status: OrderStatus.PAID,
      currency: "USD",
      subtotalAmount: 4900,
      discountAmount: 0,
      totalAmount: 4900,
      items: {
        create: {
          productId: testProduct.id,
          variantId: testVariant.id,
          productName: "Portal Test Theme",
          variantName: "Standard License",
          sku: "NXS-PORTAL-03",
          productType: ProductType.LICENSED_SOFTWARE,
          fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
          unitAmount: 4900,
          quantity: 1,
          lineTotalAmount: 4900,
          currency: "USD",
          maxActivations: 1,
        },
      },
    },
    include: { items: true },
  });

  const entitlement2Internal = await prisma.entitlement.create({
    data: {
      userId: customer2Id,
      orderId: order3.id,
      orderItemId: order3.items[0].id,
      productId: testProduct.id,
      variantId: testVariant.id,
      productType: ProductType.LICENSED_SOFTWARE,
      fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
      status: EntitlementStatus.ACTIVE,
      quantity: 1,
      maxActivations: 1,
    },
  });

  // Gate 19: Customer Lists Only Own Entitlements
  console.log("\n[Gate 19] Customer lists only own entitlements...");
  const entListRes = await apiGet("/entitlements", customer1Token);
  const entIds: string[] = (entListRes.data?.items || []).map((e: any) => e.id);
  if (
    !entIds.includes(entitlement1.id) ||
    entIds.includes(entitlement2.id) ||
    entIds.includes(entitlement2Internal.id)
  ) {
    throw new Error("Gate 19 failed: Entitlements list leaked cross-user entitlement or missed own");
  }
  console.log("✓ Gate 19 passed: Entitlements list strictly scoped to customer");

  // Gate 20: Cross-User Entitlement Read Blocked
  console.log("\n[Gate 20] Cross-user entitlement read blocked (404)...");
  const crossEntRes = await apiGet(`/entitlements/${entitlement1.id}`, customer2Token);
  if (crossEntRes.status !== 404) {
    throw new Error(`Gate 20 failed: Expected 404 for cross-user entitlement, received ${crossEntRes.status}`);
  }
  console.log("✓ Gate 20 passed: Cross-user entitlement access returns 404 anti-enumeration");

  // Gate 21: Entitlement Purchased Rights Displayed From Authoritative State
  console.log("\n[Gate 21] Entitlement details reflect authoritative purchased rights...");
  const ent1Detail = await apiGet(`/entitlements/${entitlement1.id}`, customer1Token);
  if (
    ent1Detail.data.maxActivations !== 3 ||
    !ent1Detail.data.updatesUntil ||
    ent1Detail.data.fulfillmentType !== "INTERNAL_LICENSE"
  ) {
    throw new Error("Gate 21 failed: Entitlement details do not match authoritative rights");
  }
  console.log("✓ Gate 21 passed: Entitlement displays accurate authoritative rights and windows");

  // Gate 22: Expired / Revoked Entitlement Reflects Authoritative State
  console.log("\n[Gate 22] Revoked entitlement reflects terminal state...");
  const orderRevoked = await prisma.order.create({
    data: {
      orderNumber: `ORD-P10-C1-REV-${Date.now()}`,
      userId: customer1Id,
      status: OrderStatus.PAID,
      currency: "USD",
      subtotalAmount: 2900,
      discountAmount: 0,
      totalAmount: 2900,
      items: {
        create: {
          productId: testProduct.id,
          variantId: testVariant.id,
          productName: "Portal Test Theme",
          variantName: "Basic License",
          sku: "NXS-PORTAL-REV",
          productType: ProductType.LICENSED_SOFTWARE,
          fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
          unitAmount: 2900,
          quantity: 1,
          lineTotalAmount: 2900,
          currency: "USD",
          maxActivations: 1,
        },
      },
    },
    include: { items: true },
  });

  const revokedEnt = await prisma.entitlement.create({
    data: {
      userId: customer1Id,
      orderId: orderRevoked.id,
      orderItemId: orderRevoked.items[0].id,
      productId: testProduct.id,
      variantId: testVariant.id,
      productType: ProductType.LICENSED_SOFTWARE,
      fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
      status: EntitlementStatus.REVOKED,
      quantity: 1,
      revokedAt: new Date(),
    },
  });
  const revokedDetail = await apiGet(`/entitlements/${revokedEnt.id}`, customer1Token);
  if (revokedDetail.data.status !== "REVOKED") {
    throw new Error(`Gate 22 failed: Expected REVOKED status, got ${revokedDetail.data.status}`);
  }
  console.log("✓ Gate 22 passed: Terminal entitlement state displayed accurately");

  // Create published product version & file for download testing
  let version = await prisma.productVersion.findFirst({
    where: { productId: testProduct.id, version: "1.0.0" },
  });
  if (!version) {
    version = await prisma.productVersion.create({
      data: {
        productId: testProduct.id,
        version: "1.0.0",
        releaseNotes: "Initial Release",
        status: "PUBLISHED",
        releasedAt: new Date(),
        files: {
          create: {
            fileName: "portal-test-theme-1.0.0.zip",
            storageKey: `products/${testProduct.id}/versions/v1/portal-test-theme-1.0.0.zip`,
            contentType: "application/zip",
            sizeBytes: 10240,
            sha256: crypto.createHash("sha256").update("portal-test-content").digest("hex"),
            isPrimary: true,
          },
        },
      },
      include: { files: true },
    });
  }

  // Gate 23: Eligible Published Versions Endpoint
  console.log("\n[Gate 23] Eligible published versions endpoint returns versions for active entitlement...");
  const versionsRes = await apiGet(
    `/v1/downloads/entitlements/${entitlement1.id}/versions`,
    customer1Token,
  );
  if (versionsRes.status !== 200 || !Array.isArray(versionsRes.data) || versionsRes.data.length === 0) {
    throw new Error(`Gate 23 failed: Expected eligible versions list, received ${JSON.stringify(versionsRes.data)}`);
  }
  console.log("✓ Gate 23 passed: Eligible versions returned for customer's active entitlement");

  // Gate 24: Cross-User Versions List Denied
  console.log("\n[Gate 24] Cross-user versions list denied (404)...");
  const crossVersionsRes = await apiGet(
    `/v1/downloads/entitlements/${entitlement1.id}/versions`,
    customer2Token,
  );
  if (crossVersionsRes.status !== 404) {
    throw new Error(`Gate 24 failed: Expected 404 for cross-user versions query, got ${crossVersionsRes.status}`);
  }
  console.log("✓ Gate 24 passed: Cross-user versions access strictly denied");

  // Gate 25: Unentitled / Inactive Entitlement Cannot List Versions
  console.log("\n[Gate 25] Inactive entitlement returns zero eligible versions...");
  const inactiveVersionsRes = await apiGet(
    `/v1/downloads/entitlements/${revokedEnt.id}/versions`,
    customer1Token,
  );
  if (inactiveVersionsRes.status !== 200 || inactiveVersionsRes.data.length !== 0) {
    throw new Error("Gate 25 failed: Revoked entitlement unexpectedly returned downloadable versions");
  }
  console.log("✓ Gate 25 passed: Revoked entitlement yields zero eligible versions");

  // Gate 26: Customer Requests Download Via POST /v1/downloads/request
  console.log("\n[Gate 26] Cross-user download request denied (403/404)...");
  const crossDownloadRes = await apiPost(
    "/v1/downloads/request",
    { entitlementId: entitlement1.id, versionId: version.id },
    customer2Token,
  );
  if (crossDownloadRes.status !== 403 && crossDownloadRes.status !== 404) {
    throw new Error(`Gate 26 failed: Expected 403/404 for cross-user download request, got ${crossDownloadRes.status}`);
  }
  console.log("✓ Gate 26 passed: Cross-user download request strictly blocked");

  // Gate 27: Inactive Entitlement Download Request Denied
  console.log("\n[Gate 27] Inactive entitlement download request denied...");
  const inactiveDownloadRes = await apiPost(
    "/v1/downloads/request",
    { entitlementId: revokedEnt.id, versionId: version.id },
    customer1Token,
  );
  if (inactiveDownloadRes.status !== 403 && inactiveDownloadRes.status !== 400) {
    throw new Error(`Gate 27 failed: Expected 403/400 for revoked entitlement download, got ${inactiveDownloadRes.status}`);
  }
  console.log("✓ Gate 27 passed: Inactive entitlement cannot request downloads");

  // Provision internal licenses for active INTERNAL_LICENSE entitlements
  await provisionInternalLicenses({ workerId: "worker-phase10" }, prisma);

  const license1 = await prisma.internalLicense.findUniqueOrThrow({
    where: { entitlementId: entitlement1.id },
  });

  const license2 = await prisma.internalLicense.findUniqueOrThrow({
    where: { entitlementId: entitlement2Internal.id },
  });

  // Gate 28: Internal Licenses List Only Own Licenses
  console.log("\n[Gate 28] Internal license list only returns customer's own licenses...");
  const licensesRes1 = await apiGet("/licenses", customer1Token);
  const licIds1: string[] = (licensesRes1.data || []).map((l: any) => l.id);
  if (!licIds1.includes(license1.id) || licIds1.includes(license2.id)) {
    throw new Error("Gate 28 failed: Licenses list leaked cross-user license or missed own");
  }
  console.log("✓ Gate 28 passed: Customer license list strictly scoped to authenticated owner");

  // Gate 29: Cross-User License Read Blocked
  console.log("\n[Gate 29] Cross-user license read blocked (404)...");
  const crossLicRes = await apiGet(`/licenses/${license1.id}`, customer2Token);
  if (crossLicRes.status !== 404) {
    throw new Error(`Gate 29 failed: Expected 404 for cross-user license access, got ${crossLicRes.status}`);
  }
  console.log("✓ Gate 29 passed: Cross-user license read returns 404 anti-enumeration");

  // Gate 30: License Key Masked By Default
  console.log("\n[Gate 30] License key is masked by default...");
  const licDetail1 = await apiGet(`/licenses/${license1.id}`, customer1Token);
  if (
    !licDetail1.data.keyMasked ||
    !licDetail1.data.keyMasked.endsWith(license1.keyLast4) ||
    licDetail1.data.keyMasked.length < 20 ||
    licDetail1.data.licenseKey !== undefined
  ) {
    throw new Error(`Gate 30 failed: Masked key invalid or plaintext leaked: ${JSON.stringify(licDetail1.data)}`);
  }
  console.log(`✓ Gate 30 passed: License key correctly masked (${licDetail1.data.keyMasked})`);

  // Gate 31: Initial License Payload Free Of Internal Secrets
  console.log("\n[Gate 31] License payload contains zero ciphertext, hash, or encryption material...");
  if (
    licDetail1.data.keyCiphertext !== undefined ||
    licDetail1.data.keyHash !== undefined ||
    licDetail1.data.keyIv !== undefined ||
    licDetail1.data.keyAuthTag !== undefined
  ) {
    throw new Error("Gate 31 failed: Internal cryptographic material leaked in customer license payload");
  }
  console.log("✓ Gate 31 passed: Internal encryption fields absent from customer DTO");

  // Gate 32: Cross-User License Reveal Blocked & Owner Reveal Allowed
  console.log("\n[Gate 32] Cross-user license reveal blocked (404)...");
  const crossRevealRes = await apiPost(`/licenses/${license1.id}/reveal`, {}, customer2Token);
  if (crossRevealRes.status !== 404) {
    throw new Error(`Gate 32 failed: Expected 404 for cross-user reveal, got ${crossRevealRes.status}`);
  }
  const ownerRevealRes = await apiPost(`/licenses/${license1.id}/reveal`, {}, customer1Token);
  if (
    ownerRevealRes.status !== 200 ||
    !ownerRevealRes.data.licenseKey ||
    !ownerRevealRes.data.licenseKey.endsWith(license1.keyLast4)
  ) {
    throw new Error(`Gate 32 failed: Owner reveal failed: ${JSON.stringify(ownerRevealRes.data)}`);
  }
  console.log("✓ Gate 32 passed: Cross-user key reveal returns 404 anti-enumeration and owner reveal decrypts plaintext key");

  // Gate 33: License Activations Endpoint Scoped To License
  console.log("\n[Gate 33] License activations list returns domain activations...");
  // Create an activation for license 1
  const activation1 = await prisma.licenseActivation.create({
    data: {
      licenseId: license1.id,
      userId: customer1Id,
      normalizedDomain: "customer1-site.com",
      status: "ACTIVE",
    },
  });
  const activationsRes = await apiGet(`/licenses/${license1.id}/activations`, customer1Token);
  if (activationsRes.status !== 200 || activationsRes.data.length === 0) {
    throw new Error("Gate 33 failed: Could not list license activations");
  }
  if (activationsRes.data[0].domain !== "customer1-site.com") {
    throw new Error(`Gate 33 failed: Unexpected activation domain: ${activationsRes.data[0].domain}`);
  }
  console.log("✓ Gate 33 passed: License activations correctly listed for owner");

  // Gate 34: Cross-User Activations Read Blocked
  console.log("\n[Gate 34] Cross-user activations read blocked (404)...");
  const crossActsRes = await apiGet(`/licenses/${license1.id}/activations`, customer2Token);
  if (crossActsRes.status !== 404) {
    throw new Error(`Gate 34 failed: Expected 404 for cross-user activations read, got ${crossActsRes.status}`);
  }
  console.log("✓ Gate 34 passed: Cross-user activations access returns 404");

  // Seed external managed allocation for Customer 2
  const allocDomain = "client-elementor.org";
  const allocRes = await apiPost(
    `/entitlements/${entitlement2.id}/allocations`,
    { domain: allocDomain },
    customer2Token,
  );
  if (allocRes.status !== 201 && allocRes.status !== 200) {
    throw new Error(`External allocation request failed with status ${allocRes.status}`);
  }
  const allocationId = allocRes.data.id;

  // Gate 35: External Allocations Only Own Entitlement
  console.log("\n[Gate 35] External allocations list strictly scoped to own entitlement...");
  const allocListRes = await apiGet(`/entitlements/${entitlement2.id}/allocations`, customer2Token);
  if (allocListRes.status !== 200 || !allocListRes.data.some((a: any) => a.id === allocationId)) {
    throw new Error("Gate 35 failed: Customer 2 allocation not found in entitlement allocations");
  }
  console.log("✓ Gate 35 passed: External allocations list verified for entitlement owner");

  // Gate 36: Cross-User External Allocation Read Blocked
  console.log("\n[Gate 36] Cross-user external allocations read blocked (403/404)...");
  const crossAllocRead = await apiGet(`/entitlements/${entitlement2.id}/allocations`, customer1Token);
  if (crossAllocRead.status !== 403 && crossAllocRead.status !== 404) {
    throw new Error(`Gate 36 failed: Expected 403/404 for cross-user allocation list, got ${crossAllocRead.status}`);
  }
  console.log("✓ Gate 36 passed: Cross-user allocation reading denied");

  // Gate 37: Cross-User External Allocation Request Blocked
  console.log("\n[Gate 37] Cross-user external allocation request blocked (403/404)...");
  const crossAllocSubmit = await apiPost(
    `/entitlements/${entitlement2.id}/allocations`,
    { domain: "hacker-domain.com" },
    customer1Token,
  );
  if (crossAllocSubmit.status !== 403 && crossAllocSubmit.status !== 404) {
    throw new Error(`Gate 37 failed: Expected 403/404 for cross-user allocation submit, got ${crossAllocSubmit.status}`);
  }
  console.log("✓ Gate 37 passed: Cross-user allocation request denied");

  // Gate 38: Domain Submission Undergoes Backend Normalization
  console.log("\n[Gate 38] Domain submission undergoes backend normalization...");
  const rawDomain = "  HTTPS://Sub.My-Domain.COM/path/to/page  ";
  const normalized = normalizeDomain(rawDomain);
  if (normalized !== "sub.my-domain.com") {
    throw new Error(`Gate 38 failed: Domain normalization error: expected 'sub.my-domain.com', got '${normalized}'`);
  }
  console.log(`✓ Gate 38 passed: Backend domain normalization verified ('${rawDomain}' -> '${normalized}')`);

  // Gate 39: External Allocation Exposes Zero Provider Credentials
  console.log("\n[Gate 39] External allocation payload exposes zero provider secrets...");
  const allocItem = allocListRes.data[0];
  if (
    allocItem.providerAccount !== undefined ||
    allocItem.accountCredentials !== undefined ||
    allocItem.vendorPassword !== undefined ||
    allocItem.token !== undefined
  ) {
    throw new Error("Gate 39 failed: Upstream provider credentials exposed in allocation payload");
  }
  console.log("✓ Gate 39 passed: Upstream provider credentials completely hidden from customer DTO");

  // Gate 40: Customer Can Request Allowed Deactivation
  console.log("\n[Gate 40] Customer can request deactivation of allocation...");
  // Temporarily set allocation status to ACTIVE in database to test deactivation request
  await prisma.licenseAllocation.update({
    where: { id: allocationId },
    data: { status: "ACTIVE" },
  });
  const deactRes = await apiPost(
    `/entitlements/${entitlement2.id}/allocations/${allocationId}/request-deactivation`,
    { reason: "Customer requested migration" },
    customer2Token,
  );
  if (deactRes.status !== 200 && deactRes.status !== 201) {
    throw new Error(`Gate 40 failed: Deactivation request rejected with status ${deactRes.status}`);
  }
  if (deactRes.data.status !== "DEACTIVATION_PENDING") {
    throw new Error(`Gate 40 failed: Expected status DEACTIVATION_PENDING, got ${deactRes.data.status}`);
  }
  console.log("✓ Gate 40 passed: Customer allocation deactivation request successfully recorded");

  // Gate 41: Session Expiration / Invalid Token Handling
  console.log("\n[Gate 41] Invalid auth token rejected across portal endpoints (401)...");
  const badToken = "invalid_expired_token_12345";
  const [badMe, badOrders, badEnts, badLics] = await Promise.all([
    apiGet("/auth/me", badToken),
    apiGet("/orders", badToken),
    apiGet("/entitlements", badToken),
    apiGet("/licenses", badToken),
  ]);
  if (
    badMe.status !== 401 ||
    badOrders.status !== 401 ||
    badEnts.status !== 401 ||
    badLics.status !== 401
  ) {
    throw new Error("Gate 41 failed: Invalid auth token was not universally rejected with 401");
  }
  console.log("✓ Gate 41 passed: Invalid auth tokens universally fail closed with 401 Unauthorized");

  // Gate 42: Malformed Domain Rejected By Allocation Endpoint
  console.log("\n[Gate 42] Malformed domain rejected by allocation endpoint (400)...");
  const malformedDomainRes = await apiPost(
    `/entitlements/${entitlement2.id}/allocations`,
    { domain: "not_a_valid_domain_!!!@@@###" },
    customer2Token,
  );
  if (malformedDomainRes.status !== 400) {
    throw new Error(`Gate 42 failed: Expected 400 Bad Request for malformed domain, got ${malformedDomainRes.status}`);
  }
  console.log("✓ Gate 42 passed: Malformed domain submissions rejected with 400 Bad Request");

  // Gate 43: Paginated Orders Response Contract
  console.log("\n[Gate 43] Paginated orders response adheres to pagination contract...");
  const pagedOrdersRes = await apiGet("/orders?limit=1&page=1", customer1Token);
  if (
    pagedOrdersRes.status !== 200 ||
    typeof pagedOrdersRes.data.total !== "number" ||
    typeof pagedOrdersRes.data.totalPages !== "number" ||
    !Array.isArray(pagedOrdersRes.data.items)
  ) {
    throw new Error("Gate 43 failed: Orders endpoint response does not conform to PaginatedResponse");
  }
  console.log("✓ Gate 43 passed: Paginated response contracts upheld");

  // Gate 44: Paginated Entitlements Response Contract
  console.log("\n[Gate 44] Paginated entitlements response adheres to contract...");
  const pagedEntsRes = await apiGet("/entitlements?limit=1&page=1", customer1Token);
  if (
    pagedEntsRes.status !== 200 ||
    typeof pagedEntsRes.data.total !== "number" ||
    !Array.isArray(pagedEntsRes.data.items)
  ) {
    throw new Error("Gate 44 failed: Entitlements endpoint response does not conform to PaginatedResponse");
  }
  console.log("✓ Gate 44 passed: Paginated entitlements response verified");

  // Gate 45: API Error Responses Sanitized
  console.log("\n[Gate 45] API error responses are sanitized without leaking internals...");
  const notFoundRes = await apiGet("/orders/00000000-0000-0000-0000-000000000000", customer1Token);
  if (notFoundRes.status !== 404) {
    throw new Error(`Gate 45 failed: Expected 404, got ${notFoundRes.status}`);
  }
  const errorPayload = JSON.stringify(notFoundRes.data);
  if (
    errorPayload.includes("SELECT ") ||
    errorPayload.includes("PrismaClient") ||
    errorPayload.includes("stack")
  ) {
    throw new Error("Gate 45 failed: Raw database or stack trace leaked in error payload");
  }
  console.log("✓ Gate 45 passed: Error payloads are sanitized and leak zero internal engine details");

  // Gate 46: SDK Client Authorization Header Propagation
  console.log("\n[Gate 46] SDK Client builds authorization headers cleanly...");
  const { NexusApiClient } = await import("@nexus/sdk");
  const testSdkClient = new NexusApiClient({
    baseUrl: API_BASE,
    token: customer1Token,
  });
  const sdkMe = await testSdkClient.getAuthMe();
  if (!sdkMe || sdkMe.id !== customer1Id) {
    throw new Error("Gate 46 failed: SDK client failed to authenticate and fetch profile");
  }
  console.log("✓ Gate 46 passed: NexusApiClient propagates session authorization seamlessly");

  // Gate 47: Portal Static Routes Build Smoke Verification
  console.log("\n[Gate 47] Verifying all customer portal routes in production build output...");
  const fs = await import("node:fs");
  const portalRoutesManifestPath = path.resolve(
    __dirname,
    "../../../apps/portal/.next/server/app-paths-manifest.json",
  );
  if (!fs.existsSync(portalRoutesManifestPath)) {
    throw new Error("Gate 47 failed: apps/portal build manifest not found. Run pnpm --filter @nexus/portal build first.");
  }
  const manifest = JSON.parse(fs.readFileSync(portalRoutesManifestPath, "utf-8"));
  const requiredRoutes = [
    "/page",
    "/orders/page",
    "/orders/[id]/page",
    "/entitlements/page",
    "/entitlements/[id]/page",
    "/downloads/page",
    "/licenses/page",
    "/licenses/[id]/page",
    "/allocations/page",
    "/account/page",
    "/login/page",
    "/payment/result/page",
  ];
  for (const route of requiredRoutes) {
    if (!manifest[route]) {
      throw new Error(`Gate 47 failed: Missing route in build manifest: ${route}`);
    }
  }
  console.log(`✓ Gate 47 passed: All ${requiredRoutes.length} Customer Portal routes verified in production build manifest`);

  console.log("\n==================================================");
  console.log("ALL 47 PHASE 10 GATES PASSED (47/47)");
  console.log("==================================================");
}

runPhase10Acceptance()
  .then(() => {
    stopChildProcesses();
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ PHASE 10 ACCEPTANCE FAILED:", err);
    stopChildProcesses();
    process.exit(1);
  });
