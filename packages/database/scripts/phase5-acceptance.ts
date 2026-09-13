import * as crypto from "node:crypto";
import { prisma, OrderStatus, EntitlementStatus, ProductType, FulfillmentType, Currency } from "../src/client";
import { processOutboxEvents } from "../../../apps/worker/src/outbox-processor";
import { issueEntitlementsForOrder } from "../../../apps/worker/src/entitlement-issuer";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { NexusApiClient } = require("../../../packages/sdk");

const API_BASE = process.env.API_URL || "http://localhost:4000";
const TEST_WEBHOOK_SECRET =
  process.env.TEST_PAYMENT_WEBHOOK_SECRET || "change-me-local-only";

function getTestWebhookSignature(payload: {
  externalEventId: string;
  paymentId: string;
  eventType: string;
}): string {
  const content = `${payload.externalEventId}:${payload.paymentId}:${payload.eventType}`;
  return crypto
    .createHmac("sha256", TEST_WEBHOOK_SECRET)
    .update(content)
    .digest("hex");
}

async function runAcceptance() {
  console.log("==================================================");
  console.log("PHASE 5 — ENTITLEMENT ENGINE LIVE RUNTIME ACCEPTANCE");
  console.log("==================================================\n");

  const customerToken = "dev-customer-token";
  const customer2Token = "dev-no-email:sub_dev_customer_002";
  const adminToken = "dev-admin-token";

  // Fetch customer profile
  const customerMeRes = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  if (!customerMeRes.ok) throw new Error(`Failed to fetch customer profile: ${customerMeRes.status}`);
  const customerUser: any = await customerMeRes.json();

  const customer2MeRes = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${customer2Token}` },
  });
  if (!customer2MeRes.ok) throw new Error(`Failed to fetch customer2 profile: ${customer2MeRes.status}`);
  const customer2User: any = await customer2MeRes.json();

  const adminMeRes = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!adminMeRes.ok) throw new Error(`Failed to fetch admin profile: ${adminMeRes.status}`);
  const adminUser: any = await adminMeRes.json();

  console.log(`Actor 1 (Customer): ${customerUser.id} (${customerUser.email})`);
  console.log(`Actor 2 (Customer 2): ${customer2User.id} (${customer2User.email})`);
  console.log(`Actor 3 (Admin): ${adminUser.id} (${adminUser.email})\n`);

  // ----------------------------------------------------
  // Gate 1: Health 200 OK
  // ----------------------------------------------------
  console.log("[Gate 1] Checking API Health...");
  const healthRes = await fetch(`${API_BASE}/health`);
  if (!healthRes.ok) throw new Error(`Health check failed: ${healthRes.status}`);
  const healthData: any = await healthRes.json();
  if (healthData.status !== "ok") throw new Error("Health status is not ok");
  console.log("✓ Gate 1 passed: Health status 200 OK\n");

  // ----------------------------------------------------
  // Gate 2: Catalog Products & License Plans Setup
  // ----------------------------------------------------
  console.log("[Gate 2] Resolving products with Lifetime and Duration license plans...");
  // Plan 1: Lifetime (Nexus Pro 1 site)
  const lifetimeVariant = await prisma.productVariant.findFirst({
    where: {
      status: "ACTIVE",
      licensePlan: { isLifetime: true },
      prices: { some: { currency: Currency.USD, isActive: true } },
    },
    include: { licensePlan: true, product: true, prices: true },
  });
  if (!lifetimeVariant) throw new Error("Could not find active variant with lifetime plan in USD");

  // Plan 2: Duration Plan (ensure 30 days or 12 months)
  let expiringPlan = await prisma.licensePlan.findFirst({
    where: { isLifetime: false, durationDays: { gt: 0 } },
  });
  if (!expiringPlan) {
    expiringPlan = await prisma.licensePlan.create({
      data: {
        id: "plan-test-30days",
        name: "Test 30-Day Pass",
        isLifetime: false,
        durationDays: 30,
        maxActivations: 1,
      },
    });
  }

  // Find or create an expiring variant
  let expiringVariant = await prisma.productVariant.findFirst({
    where: {
      status: "ACTIVE",
      licensePlanId: expiringPlan.id,
      prices: { some: { currency: Currency.USD, isActive: true } },
    },
    include: { licensePlan: true, product: true, prices: true },
  });

  if (!expiringVariant) {
    // Attach expiring plan to an existing product variant or create one
    const pElementor = await prisma.product.findFirst({ where: { status: "ACTIVE" } });
    if (!pElementor) throw new Error("No active product found");
    expiringVariant = await prisma.productVariant.upsert({
      where: { sku: "TEST-EXP-30DAYS" },
      update: { licensePlanId: expiringPlan.id, status: "ACTIVE" },
      create: {
        productId: pElementor.id,
        sku: "TEST-EXP-30DAYS",
        name: "30-Day Test License",
        status: "ACTIVE",
        licensePlanId: expiringPlan.id,
        sortOrder: 99,
      },
      include: { licensePlan: true, product: true, prices: true },
    });
    await prisma.productPrice.deleteMany({
      where: { variantId: expiringVariant.id, currency: Currency.USD },
    });
    await prisma.productPrice.create({
      data: { variantId: expiringVariant.id, currency: Currency.USD, amount: 1500, billingType: "ONE_TIME", isActive: true },
    });
  }

  console.log(`  Variant 1 (Lifetime): ${lifetimeVariant.sku} - ${lifetimeVariant.licensePlan?.name} (isLifetime: ${lifetimeVariant.licensePlan?.isLifetime})`);
  console.log(`  Variant 2 (Expiring): ${expiringVariant.sku} - ${expiringVariant.licensePlan?.name} (durationDays: ${expiringVariant.licensePlan?.durationDays})`);
  console.log("✓ Gate 2 passed: Lifetime and Expiring license plans verified\n");

  // ----------------------------------------------------
  // Gate 3: Customer 1 Multi-Item Cart & Checkout
  // ----------------------------------------------------
  console.log("[Gate 3] Customer 1 adding both items to cart and checking out...");
  // Clear cart
  await fetch(`${API_BASE}/cart`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${customerToken}` },
  });

  // Add Item 1 (Lifetime)
  const add1Res = await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${customerToken}` },
    body: JSON.stringify({ variantId: lifetimeVariant.id, quantity: 1, currency: "USD" }),
  });
  if (!add1Res.ok) throw new Error(`Failed to add item 1: ${await add1Res.text()}`);

  // Add Item 2 (Expiring)
  const add2Res = await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${customerToken}` },
    body: JSON.stringify({ variantId: expiringVariant.id, quantity: 1, currency: "USD" }),
  });
  if (!add2Res.ok) throw new Error(`Failed to add item 2: ${await add2Res.text()}`);

  // Checkout
  const checkoutKey = `key-phase5-chk-${Date.now()}`;
  const checkoutRes = await fetch(`${API_BASE}/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
      "Idempotency-Key": checkoutKey,
    },
    body: JSON.stringify({ currency: "USD" }),
  });
  if (!checkoutRes.ok) throw new Error(`Checkout failed: ${await checkoutRes.text()}`);
  const checkoutData: any = await checkoutRes.json();
  const order1 = checkoutData.order;
  const payment1 = checkoutData.payment;

  if (order1.status !== OrderStatus.PENDING_PAYMENT) {
    throw new Error(`Expected Order to be PENDING_PAYMENT, got: ${order1.status}`);
  }
  if (order1.items.length !== 2) {
    throw new Error(`Expected order to have 2 items, got ${order1.items.length}`);
  }
  console.log(`✓ Gate 3 passed: Order created ${order1.orderNumber} (${order1.id}) with 2 items\n`);

  // ----------------------------------------------------
  // Gate 4: Zero Entitlements for PENDING_PAYMENT Order
  // ----------------------------------------------------
  console.log("[Gate 4] Verifying 0 entitlements exist for PENDING_PAYMENT order...");
  const preEntitlements = await prisma.entitlement.findMany({
    where: { orderId: order1.id },
  });
  if (preEntitlements.length !== 0) {
    throw new Error(`Gate 4 failed: Expected 0 entitlements for unpaid order, found ${preEntitlements.length}`);
  }
  console.log("✓ Gate 4 passed: Zero entitlements exist prior to payment\n");

  // ----------------------------------------------------
  // Gate 5: Payment Succeeded & Exactly-One ORDER_PAID Outbox
  // ----------------------------------------------------
  console.log("[Gate 5] Simulating payment callback SUCCEEDED...");
  const webhookEventId = `wh_evt_p5_${Date.now()}`;
  const signature = getTestWebhookSignature({
    externalEventId: webhookEventId,
    paymentId: payment1.id,
    eventType: "payment.succeeded",
  });

  const webhookRes = await fetch(`${API_BASE}/payments/test-callback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-test-signature": signature,
    },
    body: JSON.stringify({
      externalEventId: webhookEventId,
      paymentId: payment1.id,
      eventType: "payment.succeeded",
      amount: payment1.amount,
      currency: "USD",
    }),
  });
  if (!webhookRes.ok) throw new Error(`Payment callback failed: ${await webhookRes.text()}`);

  const updatedOrder = await prisma.order.findUnique({ where: { id: order1.id } });
  if (updatedOrder?.status !== OrderStatus.PAID) {
    throw new Error(`Expected order status PAID, got: ${updatedOrder?.status}`);
  }

  const outboxEvents = await prisma.outboxEvent.findMany({
    where: { aggregateId: order1.id, eventType: "ORDER_PAID" },
  });
  if (outboxEvents.length !== 1) {
    throw new Error(`Expected exactly 1 ORDER_PAID outbox event, found: ${outboxEvents.length}`);
  }
  console.log(`✓ Gate 5 passed: Order transitioned to PAID, 1 ORDER_PAID outbox event created (${outboxEvents[0].id})\n`);

  // ----------------------------------------------------
  // Gate 6: Worker Outbox Processing
  // ----------------------------------------------------
  console.log("[Gate 6] Worker executing outbox event processing...");
  const workerResult = await processOutboxEvents({ workerId: "worker-phase5-live" });
  console.log(`  Worker processed count: ${workerResult.processedCount}`);

  const processedOutbox = await prisma.outboxEvent.findUnique({ where: { id: outboxEvents[0].id } });
  if (processedOutbox?.status !== "PROCESSED") {
    throw new Error(`Expected outbox event to be PROCESSED, got: ${processedOutbox?.status}`);
  }
  console.log("✓ Gate 6 passed: ORDER_PAID event processed successfully\n");

  // ----------------------------------------------------
  // Gate 7: Authoritative Entitlement Issuance & Policy
  // ----------------------------------------------------
  console.log("[Gate 7] Validating issued entitlements attributes and expiration policy...");
  const entitlements = await prisma.entitlement.findMany({
    where: { orderId: order1.id },
    include: { orderItem: true },
  });

  if (entitlements.length !== 2) {
    throw new Error(`Expected exactly 2 entitlements for 2 order items, found: ${entitlements.length}`);
  }

  const lifetimeEnt = entitlements.find((e) => e.variantId === lifetimeVariant.id);
  const expiringEnt = entitlements.find((e) => e.variantId === expiringVariant.id);

  if (!lifetimeEnt) throw new Error("Lifetime entitlement not found");
  if (!expiringEnt) throw new Error("Expiring entitlement not found");

  // Invariants check
  for (const ent of entitlements) {
    if (ent.userId !== customerUser.id) throw new Error(`Entitlement userId mismatch: expected ${customerUser.id}, got ${ent.userId}`);
    if (ent.status !== EntitlementStatus.ACTIVE) throw new Error(`Entitlement status must be ACTIVE, got: ${ent.status}`);
    if (ent.quantity !== 1) throw new Error(`Entitlement quantity mismatch, expected 1, got ${ent.quantity}`);
    if (!ent.activatedAt) throw new Error("Entitlement activatedAt must be set");
    if (!ent.metadata || typeof ent.metadata !== "object") throw new Error("Entitlement metadata missing");
  }

  // Lifetime policy: expiresAt MUST be null
  if (lifetimeEnt.expiresAt !== null) {
    throw new Error(`Lifetime entitlement must have null expiresAt, got: ${lifetimeEnt.expiresAt}`);
  }
  console.log(`  ✓ Lifetime entitlement (${lifetimeEnt.id}): expiresAt is null`);

  // Expiring policy: expiresAt MUST be ~30 days in future
  if (!expiringEnt.expiresAt) {
    throw new Error("Expiring entitlement must have non-null expiresAt");
  }
  const diffDays = (expiringEnt.expiresAt.getTime() - expiringEnt.activatedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (Math.round(diffDays) !== 30) {
    throw new Error(`Expected ~30 days duration, got diff: ${diffDays}`);
  }
  console.log(`  ✓ Expiring entitlement (${expiringEnt.id}): expiresAt is ${expiringEnt.expiresAt.toISOString()} (exactly ${Math.round(diffDays)} days)`);

  // Audit log check
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      action: "ENTITLEMENT_CREATED",
      entity: "Entitlement",
      entityId: { in: entitlements.map((e) => e.id) },
    },
  });
  if (auditLogs.length !== 2) {
    throw new Error(`Expected 2 ENTITLEMENT_CREATED audit logs, found: ${auditLogs.length}`);
  }
  console.log("✓ Gate 7 passed: Entitlements issued with exact attributes and atomic audit logs\n");

  // ----------------------------------------------------
  // Gate 8: Exactly-Once Idempotency & Replay / Crash Recovery
  // ----------------------------------------------------
  console.log("[Gate 8] Testing replay / crash recovery idempotency...");
  // Re-run issuance on the same paid order
  const replayResult = await issueEntitlementsForOrder(order1.id);
  if (replayResult.issuedCount !== 2) {
    throw new Error(`Expected replay to return 2 existing entitlements, got: ${replayResult.issuedCount}`);
  }

  const postReplayCount = await prisma.entitlement.count({ where: { orderId: order1.id } });
  if (postReplayCount !== 2) {
    throw new Error(`Replay created duplicates! Expected 2, got: ${postReplayCount}`);
  }

  // Re-run worker after resetting event to PENDING
  await prisma.outboxEvent.update({
    where: { id: outboxEvents[0].id },
    data: { status: "PENDING", processedAt: null },
  });
  await processOutboxEvents({ workerId: "worker-phase5-replay" });

  const postWorkerReplayCount = await prisma.entitlement.count({ where: { orderId: order1.id } });
  if (postWorkerReplayCount !== 2) {
    throw new Error(`Worker replay created duplicate entitlements! Expected 2, got: ${postWorkerReplayCount}`);
  }
  console.log("✓ Gate 8 passed: Exactly-once idempotency preserved under replay and crash recovery\n");

  // ----------------------------------------------------
  // Gate 9: Concurrent Multi-Worker Race Protection
  // ----------------------------------------------------
  console.log("[Gate 9] Testing concurrent worker race on same order...");
  // Create a second paid order directly for concurrency test
  const testOrder = await prisma.order.create({
    data: {
      orderNumber: `ORD-RACE-${Date.now()}`,
      userId: customerUser.id,
      status: OrderStatus.PAID,
      currency: Currency.USD,
      subtotalAmount: 2000,
      discountAmount: 0,
      totalAmount: 2000,
      items: {
        create: [
          {
            productId: lifetimeVariant.productId,
            variantId: lifetimeVariant.id,
            productType: lifetimeVariant.product.productType,
            fulfillmentType: lifetimeVariant.product.fulfillmentType,
            sku: lifetimeVariant.sku,
            variantName: lifetimeVariant.name,
            productName: lifetimeVariant.product.name,
            unitAmount: 2000,
            lineTotalAmount: 2000,
            quantity: 1,
            currency: Currency.USD,
          },
        ],
      },
    },
  });

  // Launch two concurrent worker issuances simultaneously
  const [race1, race2] = await Promise.all([
    issueEntitlementsForOrder(testOrder.id),
    issueEntitlementsForOrder(testOrder.id),
  ]);

  const raceEntitlements = await prisma.entitlement.findMany({ where: { orderId: testOrder.id } });
  if (raceEntitlements.length !== 1) {
    throw new Error(`Concurrent race produced duplicate entitlements! Count: ${raceEntitlements.length}`);
  }
  console.log("✓ Gate 9 passed: Concurrent worker execution successfully linearized with 0 duplicates\n");

  // ----------------------------------------------------
  // Gate 10: Customer Entitlements API Isolation & Security
  // ----------------------------------------------------
  console.log("[Gate 10] Testing Customer API isolation & cross-user access security...");
  // Customer 1 lists their entitlements
  const cust1ListRes = await fetch(`${API_BASE}/entitlements`, {
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  if (!cust1ListRes.ok) throw new Error(`Customer 1 list entitlements failed: ${cust1ListRes.status}`);
  const cust1ListData: any = await cust1ListRes.json();
  const user1EntIds = cust1ListData.items.map((i: any) => i.id);
  if (!user1EntIds.includes(lifetimeEnt.id)) {
    throw new Error(`Customer 1 should see entitlement ${lifetimeEnt.id}`);
  }

  // Customer 1 gets their entitlement detail
  const cust1DetailRes = await fetch(`${API_BASE}/entitlements/${lifetimeEnt.id}`, {
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  if (!cust1DetailRes.ok) throw new Error(`Customer 1 get detail failed: ${cust1DetailRes.status}`);

  // Customer 2 attempts to get Customer 1's entitlement -> MUST return 404
  const crossUserRes = await fetch(`${API_BASE}/entitlements/${lifetimeEnt.id}`, {
    headers: { Authorization: `Bearer ${customer2Token}` },
  });
  if (crossUserRes.status !== 404) {
    throw new Error(`Cross-user access security failure: Expected 404 Not Found, got ${crossUserRes.status}`);
  }

  // Customer 2 lists entitlements -> must not include Customer 1's
  const cust2ListRes = await fetch(`${API_BASE}/entitlements`, {
    headers: { Authorization: `Bearer ${customer2Token}` },
  });
  const cust2ListData: any = await cust2ListRes.json();
  const cust2Ids = cust2ListData.items.map((i: any) => i.id);
  if (cust2Ids.includes(lifetimeEnt.id)) {
    throw new Error("Customer 2 list contains Customer 1's entitlement!");
  }
  console.log("✓ Gate 10 passed: Strict customer isolation verified (cross-user returns 404)\n");

  // ----------------------------------------------------
  // Gate 11: Admin Entitlements API & RBAC
  // ----------------------------------------------------
  console.log("[Gate 11] Testing Admin Entitlements API & RBAC enforcement...");
  // Customer forbidden from admin endpoints
  const custAdminRes = await fetch(`${API_BASE}/admin/entitlements`, {
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  if (custAdminRes.status !== 403) {
    throw new Error(`Expected 403 Forbidden for customer accessing admin endpoint, got ${custAdminRes.status}`);
  }

  // Admin access succeeds
  const adminListRes = await fetch(`${API_BASE}/admin/entitlements?userId=${customerUser.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!adminListRes.ok) throw new Error(`Admin list entitlements failed: ${adminListRes.status}`);
  const adminListData: any = await adminListRes.json();
  const adminListIds = adminListData.items.map((i: any) => i.id);
  if (!adminListIds.includes(lifetimeEnt.id)) {
    throw new Error("Admin query did not return expected entitlement");
  }

  const adminDetailRes = await fetch(`${API_BASE}/admin/entitlements/${lifetimeEnt.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!adminDetailRes.ok) throw new Error(`Admin get entitlement failed: ${adminDetailRes.status}`);
  console.log("✓ Gate 11 passed: Admin RBAC correctly restricts customers and allows authorized admins\n");

  // ----------------------------------------------------
  // Gate 12: Admin Revoke with CAS & Atomic Audit
  // ----------------------------------------------------
  console.log("[Gate 12] Testing Admin Revoke with CAS and atomic audit trail...");
  const revokeRes = await fetch(`${API_BASE}/admin/entitlements/${expiringEnt.id}/revoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ reason: "Chargeback reported by payment gateway" }),
  });
  if (!revokeRes.ok) throw new Error(`Revoke failed: ${await revokeRes.text()}`);
  const revokedData: any = await revokeRes.json();
  if (revokedData.status !== EntitlementStatus.REVOKED) {
    throw new Error(`Expected status REVOKED, got: ${revokedData.status}`);
  }
  if (!revokedData.revokedAt) throw new Error("revokedAt must be populated");

  // Audit log check
  const revokeAudit = await prisma.auditLog.findFirst({
    where: {
      action: "ENTITLEMENT_REVOKED",
      entity: "Entitlement",
      entityId: expiringEnt.id,
    },
  });
  if (!revokeAudit) throw new Error("ENTITLEMENT_REVOKED audit log not found");
  if (revokeAudit.actorId !== adminUser.id) {
    throw new Error(`Audit log actorId mismatch: expected ${adminUser.id}, got ${revokeAudit.actorId}`);
  }
  if ((revokeAudit.details as any)?.reason !== "Chargeback reported by payment gateway") {
    throw new Error(`Audit log reason mismatch: got ${(revokeAudit.details as any)?.reason}`);
  }

  // Second revoke attempt -> MUST return 409 Conflict
  const doubleRevokeRes = await fetch(`${API_BASE}/admin/entitlements/${expiringEnt.id}/revoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ reason: "Second revoke should fail" }),
  });
  if (doubleRevokeRes.status !== 409) {
    throw new Error(`Expected 409 Conflict for double revoke, got ${doubleRevokeRes.status}`);
  }
  console.log("✓ Gate 12 passed: Admin revoke executed via CAS with atomic audit log and 409 conflict on replay\n");

  // ----------------------------------------------------
  // Gate 13: Expiration State CAS Conflict Verification
  // ----------------------------------------------------
  console.log("[Gate 13] Verifying EXPIRED entitlement cannot be revoked (CAS protection)...");
  // Set an entitlement directly to EXPIRED using the entitlement from Gate 9
  const expiredTestEnt = await prisma.entitlement.update({
    where: { id: raceEntitlements[0].id },
    data: {
      status: EntitlementStatus.EXPIRED,
      expiresAt: new Date(Date.now() - 30 * 86400000),
    },
  });

  const revokeExpiredRes = await fetch(`${API_BASE}/admin/entitlements/${expiredTestEnt.id}/revoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ reason: "Cannot revoke already expired" }),
  });
  if (revokeExpiredRes.status !== 409) {
    throw new Error(`Expected 409 Conflict when revoking EXPIRED entitlement, got: ${revokeExpiredRes.status}`);
  }
  console.log("✓ Gate 13 passed: State transitions strictly bound to ACTIVE state via CAS\n");

  // ----------------------------------------------------
  // Gate 14: SDK Client Integration Verification
  // ----------------------------------------------------
  console.log("[Gate 14] Testing NexusApiClient entitlement methods...");
  const customerSdk = new NexusApiClient({ baseUrl: API_BASE, token: customerToken });
  const adminSdk = new NexusApiClient({ baseUrl: API_BASE, token: adminToken });

  const sdkUserList = await customerSdk.listEntitlements();
  if (!sdkUserList.items || sdkUserList.items.length === 0) {
    throw new Error("SDK listEntitlements returned empty");
  }

  const sdkDetail = await customerSdk.getEntitlement(lifetimeEnt.id);
  if (sdkDetail.id !== lifetimeEnt.id) {
    throw new Error("SDK getEntitlement id mismatch");
  }

  const sdkAdminList = await adminSdk.listAdminEntitlements({ userId: customerUser.id });
  if (!sdkAdminList.items || sdkAdminList.items.length === 0) {
    throw new Error("SDK listAdminEntitlements returned empty");
  }

  const sdkAdminDetail = await adminSdk.getAdminEntitlement(lifetimeEnt.id);
  if (sdkAdminDetail.id !== lifetimeEnt.id) {
    throw new Error("SDK getAdminEntitlement id mismatch");
  }

  console.log("✓ Gate 14 passed: NexusApiClient methods fully operational\n");

  console.log("==================================================");
  console.log("ALL PHASE 5 RUNTIME ACCEPTANCE GATES PASSED (14/14)");
  console.log("==================================================");
}

runAcceptance()
  .catch((err) => {
    console.error("\n❌ PHASE 5 RUNTIME ACCEPTANCE FAILED:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
