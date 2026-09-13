import * as crypto from "node:crypto";
import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
import {
  prisma,
  OrderStatus,
  EntitlementStatus,
  ProductType,
  FulfillmentType,
  Currency,
  addUtcMonths,
  calculateExpirationDate,
  issueEntitlementsForOrder,
} from "../src/index";

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

let apiProcess: ChildProcess | null = null;
let worker1Process: ChildProcess | null = null;
let worker2Process: ChildProcess | null = null;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureApiRunning(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (res.ok) {
      console.log("  API server is already running and healthy.");
      return;
    }
  } catch {
    // Not running
  }

  console.log("  Starting API server child process on port 4000...");
  apiProcess = spawn("node", [path.resolve(__dirname, "../../../apps/api/dist/main.js")], {
    stdio: "pipe",
    env: { ...process.env, PORT: "4000" },
  });

  apiProcess.stderr?.on("data", (data) => {
    // console.error(`[api-err] ${data.toString()}`);
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

function startWorker(workerId: string, pollIntervalMs = "500"): ChildProcess {
  console.log(`  Spawning worker child process '${workerId}' (poll: ${pollIntervalMs}ms)...`);
  const proc = spawn("node", [path.resolve(__dirname, "../../../apps/worker/dist/index.js")], {
    stdio: "pipe",
    env: {
      ...process.env,
      WORKER_ID: workerId,
      OUTBOX_POLL_INTERVAL_MS: pollIntervalMs,
    },
  });

  proc.stderr?.on("data", (data) => {
    // console.error(`[${workerId}-err] ${data.toString()}`);
  });

  return proc;
}

async function runAcceptance() {
  console.log("==================================================");
  console.log("PHASE 5 — ENTITLEMENT ENGINE LIVE RUNTIME ACCEPTANCE (ROUND 2)");
  console.log("==================================================\n");

  const customerToken = "dev-customer-token";
  const customer2Token = "dev-no-email:sub_dev_customer_002";
  const adminToken = "dev-admin-token";

  try {
    // ----------------------------------------------------
    // Gate 1: API & Worker Runtime Initialization
    // ----------------------------------------------------
    console.log("[Gate 1] Verifying API Health & Spawning Real Worker Runtime...");
    await ensureApiRunning();

    const healthRes = await fetch(`${API_BASE}/health`);
    if (!healthRes.ok) throw new Error(`Health check failed: ${healthRes.status}`);
    const healthData: any = await healthRes.json();
    if (healthData.status !== "ok") throw new Error("Health status is not ok");

    worker1Process = startWorker("worker-acceptance-1", "500");
    await sleep(1000); // Allow worker to connect to Redis/DB

    console.log("✓ Gate 1 passed: API 200 OK & real worker runtime running\n");

    // Fetch actor identities
    const customerMeRes = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const customerUser: any = await customerMeRes.json();

    const customer2MeRes = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${customer2Token}` },
    });
    const customer2User: any = await customer2MeRes.json();

    const adminMeRes = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminUser: any = await adminMeRes.json();

    console.log(`Actor 1 (Customer 1): ${customerUser.id} (${customerUser.email})`);
    console.log(`Actor 2 (Customer 2): ${customer2User.id} (${customer2User.email})`);
    console.log(`Actor 3 (Admin): ${adminUser.id} (${adminUser.email})\n`);

    // ----------------------------------------------------
    // Gate 2: Checkout Policy Snapshot into OrderItem
    // ----------------------------------------------------
    console.log("[Gate 2] Verifying policy snapshot into OrderItem at checkout...");
    const lifetimeVariant = await prisma.productVariant.findFirst({
      where: {
        status: "ACTIVE",
        licensePlan: { isLifetime: true },
        prices: { some: { currency: Currency.USD, isActive: true } },
      },
      include: { licensePlan: true, product: true, prices: true },
    });
    if (!lifetimeVariant) throw new Error("Could not find active lifetime variant in USD");

    let expiringPlan = await prisma.licensePlan.findFirst({
      where: { isLifetime: false, durationDays: 30 },
    });
    if (!expiringPlan) {
      expiringPlan = await prisma.licensePlan.create({
        data: {
          id: `plan-test-30d-${Date.now()}`,
          name: "Test 30-Day Pass",
          isLifetime: false,
          durationDays: 30,
          maxActivations: 2,
        },
      });
    }

    let expiringVariant = await prisma.productVariant.findFirst({
      where: {
        status: "ACTIVE",
        licensePlanId: expiringPlan.id,
        prices: { some: { currency: Currency.USD, isActive: true } },
      },
      include: { licensePlan: true, product: true, prices: true },
    });

    if (!expiringVariant) {
      const activeProduct = await prisma.product.findFirst({ where: { status: "ACTIVE" } });
      if (!activeProduct) throw new Error("No active product found");
      expiringVariant = await prisma.productVariant.upsert({
        where: { sku: "TEST-EXP-30DAYS" },
        update: { licensePlanId: expiringPlan.id, status: "ACTIVE" },
        create: {
          productId: activeProduct.id,
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
        data: {
          variantId: expiringVariant.id,
          currency: Currency.USD,
          amount: 1500,
          billingType: "ONE_TIME",
          isActive: true,
        },
      });
    }

    // Customer 1 cart checkout
    await fetch(`${API_BASE}/cart`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${customerToken}` },
    });

    await fetch(`${API_BASE}/cart/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({ variantId: lifetimeVariant.id, quantity: 1, currency: "USD" }),
    });

    await fetch(`${API_BASE}/cart/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({ variantId: expiringVariant.id, quantity: 1, currency: "USD" }),
    });

    const checkoutRes = await fetch(`${API_BASE}/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customerToken}`,
        "Idempotency-Key": `chk-gate2-${Date.now()}`,
      },
      body: JSON.stringify({ currency: "USD" }),
    });
    if (!checkoutRes.ok) throw new Error(`Checkout failed: ${await checkoutRes.text()}`);
    const checkoutData: any = await checkoutRes.json();
    const order1 = checkoutData.order;
    const payment1 = checkoutData.payment;

    // Verify snapshot fields directly in OrderItem records
    const dbOrderItems = await prisma.orderItem.findMany({
      where: { orderId: order1.id },
      orderBy: { createdAt: "asc" },
    });
    if (dbOrderItems.length !== 2) {
      throw new Error(`Expected 2 order items in DB, found: ${dbOrderItems.length}`);
    }

    const item1 = dbOrderItems.find((i) => i.variantId === lifetimeVariant.id);
    const item2 = dbOrderItems.find((i) => i.variantId === expiringVariant.id);
    if (!item1 || !item2) throw new Error("Order items do not match expected variants");

    if (item1.isLifetime !== true || item1.durationDays !== null) {
      throw new Error(`Item 1 snapshot invalid: isLifetime=${item1.isLifetime}, durationDays=${item1.durationDays}`);
    }
    if (item2.isLifetime !== false || item2.durationDays !== 30 || item2.maxActivations !== expiringPlan.maxActivations) {
      throw new Error(`Item 2 snapshot invalid: isLifetime=${item2.isLifetime}, durationDays=${item2.durationDays}, maxActivations=${item2.maxActivations}`);
    }
    console.log("✓ Gate 2 passed: Policy snapshot captured directly in OrderItems\n");

    // ----------------------------------------------------
    // Gate 3: Zero Entitlements for PENDING_PAYMENT Order
    // ----------------------------------------------------
    console.log("[Gate 3] Verifying 0 entitlements exist for PENDING_PAYMENT order...");
    const unpaidEntitlements = await prisma.entitlement.findMany({
      where: { orderId: order1.id },
    });
    if (unpaidEntitlements.length !== 0) {
      throw new Error(`Expected 0 entitlements for unpaid order, found: ${unpaidEntitlements.length}`);
    }
    console.log("✓ Gate 3 passed: 0 entitlements exist prior to payment\n");

    // ----------------------------------------------------
    // Gate 4: Payment Completion & ORDER_PAID Outbox Event
    // ----------------------------------------------------
    console.log("[Gate 4] Dispatching signed payment.succeeded webhook callback...");
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

    const paidOrder = await prisma.order.findUnique({ where: { id: order1.id } });
    if (paidOrder?.status !== OrderStatus.PAID) {
      throw new Error(`Expected order status PAID, got: ${paidOrder?.status}`);
    }

    const outboxEvents = await prisma.outboxEvent.findMany({
      where: { aggregateId: order1.id, eventType: "ORDER_PAID" },
    });
    if (outboxEvents.length !== 1) {
      throw new Error(`Expected exactly 1 ORDER_PAID outbox event, found: ${outboxEvents.length}`);
    }
    console.log(`✓ Gate 4 passed: Order transitioned to PAID, 1 ORDER_PAID outbox event created\n`);

    // ----------------------------------------------------
    // Gate 5: Autonomous Worker Outbox Consumption
    // ----------------------------------------------------
    console.log("[Gate 5] Verifying autonomous worker consumption of ORDER_PAID event (no manual processOutboxEvents call)...");
    const outboxId = outboxEvents[0].id;
    let processedOutbox = null;
    const pollStart = Date.now();

    while (Date.now() - pollStart < 10000) {
      await sleep(300);
      processedOutbox = await prisma.outboxEvent.findUnique({ where: { id: outboxId } });
      if (processedOutbox?.status === "PROCESSED") {
        break;
      }
    }

    if (processedOutbox?.status !== "PROCESSED") {
      throw new Error(`Worker failed to consume outbox event autonomously within 10s: status=${processedOutbox?.status}`);
    }
    console.log(`✓ Gate 5 passed: Worker autonomously processed outbox event in background (status=${processedOutbox.status})\n`);

    // ----------------------------------------------------
    // Gate 6: Autonomous Entitlement Issuance
    // ----------------------------------------------------
    console.log("[Gate 6] Verifying autonomous entitlement creation & audit logging...");
    const orderEntitlements = await prisma.entitlement.findMany({
      where: { orderId: order1.id },
      orderBy: { createdAt: "asc" },
    });

    if (orderEntitlements.length !== 2) {
      throw new Error(`Expected 2 entitlements created by worker, found: ${orderEntitlements.length}`);
    }

    const ent1 = orderEntitlements.find((e) => e.orderItemId === item1.id);
    const ent2 = orderEntitlements.find((e) => e.orderItemId === item2.id);
    if (!ent1 || !ent2) throw new Error("Entitlements missing for order items");

    // Item 1: Lifetime -> expiresAt is null
    if (ent1.status !== EntitlementStatus.ACTIVE || ent1.expiresAt !== null) {
      throw new Error(`Lifetime entitlement invalid: status=${ent1.status}, expiresAt=${ent1.expiresAt}`);
    }

    // Item 2: 30 days -> expiresAt is approximately 30 days from now
    if (ent2.status !== EntitlementStatus.ACTIVE || !ent2.expiresAt) {
      throw new Error(`Expiring entitlement invalid: status=${ent2.status}, expiresAt=${ent2.expiresAt}`);
    }
    const daysUntilExp = (ent2.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (Math.round(daysUntilExp) !== 30) {
      throw new Error(`Expected ~30 days until expiration, calculated: ${daysUntilExp}`);
    }

    // Verify audit logs
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        action: "ENTITLEMENT_CREATED",
        entityId: { in: [ent1.id, ent2.id] },
      },
    });
    if (auditLogs.length !== 2) {
      throw new Error(`Expected 2 ENTITLEMENT_CREATED audit logs, found: ${auditLogs.length}`);
    }
    for (const log of auditLogs) {
      if (log.actorId !== null) throw new Error(`Expected actorId: null for system worker audit, got: ${log.actorId}`);
    }
    console.log("✓ Gate 6 passed: Entitlements issued autonomously with exact policy & system audit logs\n");

    // ----------------------------------------------------
    // Gate 7: Catalog Plan Mutation Resistance
    // ----------------------------------------------------
    console.log("[Gate 7] Mutating catalog plan duration (30d -> 90d) & verifying existing entitlement unchanged...");
    await prisma.licensePlan.update({
      where: { id: expiringPlan.id },
      data: { durationDays: 90 },
    });

    const refreshedEnt2 = await prisma.entitlement.findUnique({ where: { id: ent2.id } });
    if (refreshedEnt2?.expiresAt?.getTime() !== ent2.expiresAt.getTime()) {
      throw new Error("Entitlement expiration date changed after catalog mutation! Snapshot isolation violated!");
    }
    console.log("✓ Gate 7 passed: Purchased entitlement is immune to catalog plan mutations\n");

    // ----------------------------------------------------
    // Gate 8: Lifetime Snapshot Drift Resistance
    // ----------------------------------------------------
    console.log("[Gate 8] Testing lifetime snapshot drift resistance (catalog downgraded to 14 days before payment)...");
    // Checkout lifetime product
    await fetch(`${API_BASE}/cart`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    await fetch(`${API_BASE}/cart/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({ variantId: lifetimeVariant.id, quantity: 1, currency: "USD" }),
    });

    const chk3Res = await fetch(`${API_BASE}/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customerToken}`,
        "Idempotency-Key": `chk-gate8-${Date.now()}`,
      },
      body: JSON.stringify({ currency: "USD" }),
    });
    const chk3Data: any = await chk3Res.json();
    const order3 = chk3Data.order;
    const payment3 = chk3Data.payment;

    // Mutate the catalog plan to NOT be lifetime anymore!
    if (lifetimeVariant.licensePlanId) {
      await prisma.licensePlan.update({
        where: { id: lifetimeVariant.licensePlanId },
        data: { isLifetime: false, durationDays: 14 },
      });
    }

    // Now pay order 3
    const sig3 = getTestWebhookSignature({
      externalEventId: `wh_evt_gate8_${Date.now()}`,
      paymentId: payment3.id,
      eventType: "payment.succeeded",
    });
    await fetch(`${API_BASE}/payments/test-callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-signature": sig3 },
      body: JSON.stringify({
        externalEventId: `wh_evt_gate8_${Date.now()}`,
        paymentId: payment3.id,
        eventType: "payment.succeeded",
        amount: payment3.amount,
        currency: "USD",
      }),
    });

    // Wait for worker to issue entitlement
    let ent3 = null;
    const poll3Start = Date.now();
    while (Date.now() - poll3Start < 10000) {
      await sleep(300);
      ent3 = await prisma.entitlement.findFirst({ where: { orderId: order3.id } });
      if (ent3) break;
    }

    if (!ent3) throw new Error("Worker failed to issue entitlement for order 3");
    if (ent3.expiresAt !== null) {
      throw new Error(`Gate 8 failed: Entitlement has expiresAt=${ent3.expiresAt}, expected null (lifetime snapshot)`);
    }

    // Restore lifetime plan
    if (lifetimeVariant.licensePlanId) {
      await prisma.licensePlan.update({
        where: { id: lifetimeVariant.licensePlanId },
        data: { isLifetime: true, durationDays: null },
      });
    }
    console.log("✓ Gate 8 passed: Order strictly honoured lifetime snapshot despite catalog modification\n");

    // ----------------------------------------------------
    // Gate 9: Exactly-Once Semantics on Outbox / Issuer Replay
    // ----------------------------------------------------
    console.log("[Gate 9] Testing replay of issueEntitlementsForOrder on already-processed order...");
    const replayResult = await issueEntitlementsForOrder(order1.id);
    if (replayResult.issuedCount !== 2) {
      throw new Error(`Expected replay to return 2 existing entitlements, got: ${replayResult.issuedCount}`);
    }

    const postReplayCount = await prisma.entitlement.count({ where: { orderId: order1.id } });
    if (postReplayCount !== 2) {
      throw new Error(`Duplicate entitlements created on replay! Count=${postReplayCount}`);
    }

    const postReplayAudits = await prisma.auditLog.count({
      where: {
        action: "ENTITLEMENT_CREATED",
        entityId: { in: [ent1.id, ent2.id] },
      },
    });
    if (postReplayAudits !== 2) {
      throw new Error(`Duplicate audit logs created on replay! Count=${postReplayAudits}`);
    }
    console.log("✓ Gate 9 passed: Replay returned existing entitlements with 0 duplicates and 0 extra audit logs\n");

    // ----------------------------------------------------
    // Gate 10: Concurrent Collision Safety (ON CONFLICT DO NOTHING)
    // ----------------------------------------------------
    console.log("[Gate 10] Testing simultaneous concurrent execution of issueEntitlementsForOrder...");
    // Create a new paid order directly in DB
    const colOrder = await prisma.order.create({
      data: {
        orderNumber: `ORD-COL-${Date.now()}`,
        userId: customerUser.id,
        status: OrderStatus.PAID,
        currency: Currency.USD,
        subtotalAmount: 1500,
        discountAmount: 0,
        totalAmount: 1500,
      },
    });
    const colItem = await prisma.orderItem.create({
      data: {
        orderId: colOrder.id,
        productId: lifetimeVariant.productId,
        variantId: lifetimeVariant.id,
        productName: lifetimeVariant.product.name,
        variantName: lifetimeVariant.name,
        sku: lifetimeVariant.sku,
        productType: ProductType.DOWNLOADABLE_ASSET,
        fulfillmentType: FulfillmentType.DIGITAL_DOWNLOAD,
        unitAmount: 1500,
        quantity: 1,
        lineTotalAmount: 1500,
        currency: Currency.USD,
        isLifetime: true,
      },
    });

    const [resA, resB] = await Promise.all([
      issueEntitlementsForOrder(colOrder.id),
      issueEntitlementsForOrder(colOrder.id),
    ]);

    const colEntitlements = await prisma.entitlement.findMany({ where: { orderId: colOrder.id } });
    if (colEntitlements.length !== 1) {
      throw new Error(`Concurrent execution created ${colEntitlements.length} entitlements, expected 1!`);
    }

    const colAudits = await prisma.auditLog.count({
      where: { action: "ENTITLEMENT_CREATED", entityId: colEntitlements[0].id },
    });
    if (colAudits !== 1) {
      throw new Error(`Concurrent execution created ${colAudits} audit logs, expected exactly 1!`);
    }
    console.log("✓ Gate 10 passed: Concurrent collision safely resolved via ON CONFLICT DO NOTHING (1 entitlement, 1 audit)\n");

    // ----------------------------------------------------
    // Gate 11: Multi-Worker Concurrency (Two Real Background Workers)
    // ----------------------------------------------------
    console.log("[Gate 11] Spawning second real worker and testing multi-worker concurrency...");
    worker2Process = startWorker("worker-acceptance-2", "500");
    await sleep(1000);

    // Create paid order via checkout + payment
    await fetch(`${API_BASE}/cart`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    await fetch(`${API_BASE}/cart/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({ variantId: lifetimeVariant.id, quantity: 1, currency: "USD" }),
    });

    const chk5Res = await fetch(`${API_BASE}/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customerToken}`,
        "Idempotency-Key": `chk-gate11-${Date.now()}`,
      },
      body: JSON.stringify({ currency: "USD" }),
    });
    const chk5Data: any = await chk5Res.json();
    const order5 = chk5Data.order;
    const payment5 = chk5Data.payment;

    const sig5 = getTestWebhookSignature({
      externalEventId: `wh_evt_gate11_${Date.now()}`,
      paymentId: payment5.id,
      eventType: "payment.succeeded",
    });
    await fetch(`${API_BASE}/payments/test-callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-signature": sig5 },
      body: JSON.stringify({
        externalEventId: `wh_evt_gate11_${Date.now()}`,
        paymentId: payment5.id,
        eventType: "payment.succeeded",
        amount: payment5.amount,
        currency: "USD",
      }),
    });

    // Wait for either worker to process
    let ent5 = null;
    const poll5Start = Date.now();
    while (Date.now() - poll5Start < 10000) {
      await sleep(300);
      ent5 = await prisma.entitlement.findFirst({ where: { orderId: order5.id } });
      if (ent5) break;
    }

    if (!ent5) throw new Error("Multi-worker failed to process order 5");
    const count5 = await prisma.entitlement.count({ where: { orderId: order5.id } });
    if (count5 !== 1) {
      throw new Error(`Expected exactly 1 entitlement for order 5 under multi-worker, found ${count5}`);
    }
    console.log("✓ Gate 11 passed: Multi-worker concurrency verified with 0 duplicates\n");

    // ----------------------------------------------------
    // Gate 12: Customer Self-Service Entitlement Access
    // ----------------------------------------------------
    console.log("[Gate 12] Verifying Customer 1 self-service listing and details endpoints...");
    const listRes = await fetch(`${API_BASE}/entitlements`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    if (!listRes.ok) throw new Error(`List entitlements failed: ${listRes.status}`);
    const listData: any = await listRes.json();
    if (!listData.items || listData.items.length === 0) {
      throw new Error("Expected customer to have entitlements in listing");
    }

    const detailRes = await fetch(`${API_BASE}/entitlements/${ent1.id}`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    if (!detailRes.ok) throw new Error(`Get entitlement detail failed: ${detailRes.status}`);
    const detailData: any = await detailRes.json();
    if (detailData.id !== ent1.id || detailData.userId !== customerUser.id) {
      throw new Error("Entitlement detail did not match requested entitlement");
    }
    console.log(`✓ Gate 12 passed: Customer successfully retrieved entitlements (total=${listData.total})\n`);

    // ----------------------------------------------------
    // Gate 13: Cross-Customer Ownership Isolation (Anti-Enumeration 404)
    // ----------------------------------------------------
    console.log("[Gate 13] Verifying Customer 2 cannot access Customer 1 entitlement (strict 404)...");
    const crossRes = await fetch(`${API_BASE}/entitlements/${ent1.id}`, {
      headers: { Authorization: `Bearer ${customer2Token}` },
    });
    if (crossRes.status !== 404) {
      throw new Error(`Expected 404 Not Found on cross-user access, got: ${crossRes.status}`);
    }
    console.log("✓ Gate 13 passed: Cross-customer access rejected with strict 404\n");

    // ----------------------------------------------------
    // Gate 14: Admin Entitlement Access RBAC (entitlement.read)
    // ----------------------------------------------------
    console.log("[Gate 14] Verifying Admin with 'entitlement.read' can view all entitlements...");
    const adminListRes = await fetch(`${API_BASE}/admin/entitlements`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!adminListRes.ok) throw new Error(`Admin list entitlements failed: ${adminListRes.status}`);
    const adminListData: any = await adminListRes.json();
    if (!adminListData.items || adminListData.items.length === 0) {
      throw new Error("Expected admin to see entitlements");
    }

    const adminDetailRes = await fetch(`${API_BASE}/admin/entitlements/${ent1.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!adminDetailRes.ok) throw new Error(`Admin get detail failed: ${adminDetailRes.status}`);
    console.log(`✓ Gate 14 passed: Admin accessed entitlements with 'entitlement.read' (200 OK)\n`);

    // ----------------------------------------------------
    // Gate 15: Customer Forbidden from Admin Endpoints
    // ----------------------------------------------------
    console.log("[Gate 15] Verifying Customer cannot access admin entitlements endpoints (strict 403)...");
    const customerAdminRes = await fetch(`${API_BASE}/admin/entitlements`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    if (customerAdminRes.status !== 403) {
      throw new Error(`Expected 403 Forbidden for customer on admin endpoint, got: ${customerAdminRes.status}`);
    }
    console.log("✓ Gate 15 passed: Customer role forbidden from admin endpoints (403 Forbidden)\n");

    // ----------------------------------------------------
    // Gate 16: Admin Revocation CAS & Double Revoke 409
    // ----------------------------------------------------
    console.log("[Gate 16] Testing Admin revocation CAS and terminal state enforcement (double revoke 409)...");
    const revokeRes = await fetch(`${API_BASE}/admin/entitlements/${ent1.id}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ reason: "Customer requested chargeback" }),
    });
    if (!revokeRes.ok) throw new Error(`Revoke failed: ${await revokeRes.text()}`);
    const revokeData: any = await revokeRes.json();
    if (revokeData.status !== "REVOKED" || !revokeData.revokedAt) {
      throw new Error(`Expected entitlement status REVOKED, got: ${revokeData.status}`);
    }

    // Verify audit log for revocation
    const revokeAudit = await prisma.auditLog.findFirst({
      where: { action: "ENTITLEMENT_REVOKED", entityId: ent1.id },
    });
    if (!revokeAudit || revokeAudit.actorId !== adminUser.id) {
      throw new Error("Revocation audit log missing or actorId invalid");
    }

    // Double revoke attempt -> 409 Conflict
    const doubleRevokeRes = await fetch(`${API_BASE}/admin/entitlements/${ent1.id}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ reason: "Repeated revocation" }),
    });
    if (doubleRevokeRes.status !== 409) {
      throw new Error(`Expected 409 Conflict on double revocation, got: ${doubleRevokeRes.status}`);
    }
    console.log("✓ Gate 16 passed: Admin revocation CAS succeeded and double-revoke failed with 409\n");

    // ----------------------------------------------------
    // Gate 17: Autonomous Worker Expiration Engine
    // ----------------------------------------------------
    console.log("[Gate 17] Creating active entitlement with past expiresAt and verifying autonomous worker expiration...");
    const pastOrderItem = await prisma.orderItem.create({
      data: {
        orderId: order1.id,
        productId: expiringVariant.productId,
        variantId: expiringVariant.id,
        productName: expiringVariant.product.name,
        variantName: expiringVariant.name,
        sku: `SKU-EXP-17-${Date.now()}`,
        productType: ProductType.LICENSED_SOFTWARE,
        fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
        unitAmount: 1000,
        quantity: 1,
        lineTotalAmount: 1000,
        currency: Currency.USD,
        isLifetime: false,
        durationDays: 1,
      },
    });

    const pastEnt = await prisma.entitlement.create({
      data: {
        userId: customerUser.id,
        orderId: order1.id,
        orderItemId: pastOrderItem.id,
        productId: expiringVariant.productId,
        variantId: expiringVariant.id,
        productType: ProductType.LICENSED_SOFTWARE,
        fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
        status: EntitlementStatus.ACTIVE,
        quantity: 1,
        activatedAt: new Date(Date.now() - 31 * 86400000),
        expiresAt: new Date(Date.now() - 5000), // Expired 5 seconds ago
      },
    });

    let expiredRec = null;
    const expStart = Date.now();
    while (Date.now() - expStart < 10000) {
      await sleep(300);
      expiredRec = await prisma.entitlement.findUnique({ where: { id: pastEnt.id } });
      if (expiredRec?.status === EntitlementStatus.EXPIRED) {
        break;
      }
    }

    if (expiredRec?.status !== EntitlementStatus.EXPIRED) {
      throw new Error(`Worker failed to expire due entitlement within 10s: status=${expiredRec?.status}`);
    }

    const expAudit = await prisma.auditLog.findFirst({
      where: { action: "ENTITLEMENT_EXPIRED", entityId: pastEnt.id },
    });
    if (!expAudit || expAudit.actorId !== null) {
      throw new Error("ENTITLEMENT_EXPIRED audit log missing or actorId not null");
    }
    console.log("✓ Gate 17 passed: Background worker autonomously transitioned due entitlement ACTIVE -> EXPIRED\n");

    // ----------------------------------------------------
    // Gate 18: Concurrent Expiration Safety
    // ----------------------------------------------------
    console.log("[Gate 18] Testing concurrent expiration across multiple workers...");
    const itemCexp1 = await prisma.orderItem.create({
      data: {
        orderId: order1.id,
        productId: expiringVariant.productId,
        variantId: expiringVariant.id,
        productName: expiringVariant.product.name,
        variantName: expiringVariant.name,
        sku: `SKU-CEXP-1-${Date.now()}`,
        productType: ProductType.LICENSED_SOFTWARE,
        fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
        unitAmount: 1000,
        quantity: 1,
        lineTotalAmount: 1000,
        currency: Currency.USD,
        isLifetime: false,
        durationDays: 1,
      },
    });

    const itemCexp2 = await prisma.orderItem.create({
      data: {
        orderId: order1.id,
        productId: expiringVariant.productId,
        variantId: expiringVariant.id,
        productName: expiringVariant.product.name,
        variantName: expiringVariant.name,
        sku: `SKU-CEXP-2-${Date.now()}`,
        productType: ProductType.LICENSED_SOFTWARE,
        fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
        unitAmount: 1000,
        quantity: 1,
        lineTotalAmount: 1000,
        currency: Currency.USD,
        isLifetime: false,
        durationDays: 1,
      },
    });

    const batchEnts = await Promise.all([
      prisma.entitlement.create({
        data: {
          userId: customerUser.id,
          orderId: order1.id,
          orderItemId: itemCexp1.id,
          productId: expiringVariant.productId,
          variantId: expiringVariant.id,
          productType: ProductType.LICENSED_SOFTWARE,
          fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
          status: EntitlementStatus.ACTIVE,
          quantity: 1,
          activatedAt: new Date(Date.now() - 31 * 86400000),
          expiresAt: new Date(Date.now() - 3000),
        },
      }),
      prisma.entitlement.create({
        data: {
          userId: customerUser.id,
          orderId: order1.id,
          orderItemId: itemCexp2.id,
          productId: expiringVariant.productId,
          variantId: expiringVariant.id,
          productType: ProductType.LICENSED_SOFTWARE,
          fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
          status: EntitlementStatus.ACTIVE,
          quantity: 1,
          activatedAt: new Date(Date.now() - 31 * 86400000),
          expiresAt: new Date(Date.now() - 3000),
        },
      }),
    ]);

    const batchIds = batchEnts.map((b) => b.id);
    const bStart = Date.now();
    while (Date.now() - bStart < 10000) {
      await sleep(300);
      const remainingActive = await prisma.entitlement.count({
        where: { id: { in: batchIds }, status: EntitlementStatus.ACTIVE },
      });
      if (remainingActive === 0) break;
    }

    const expiredBatch = await prisma.entitlement.findMany({
      where: { id: { in: batchIds } },
    });
    for (const b of expiredBatch) {
      if (b.status !== EntitlementStatus.EXPIRED) {
        throw new Error(`Entitlement ${b.id} not expired: status=${b.status}`);
      }
    }

    const batchAudits = await prisma.auditLog.findMany({
      where: { action: "ENTITLEMENT_EXPIRED", entityId: { in: batchIds } },
    });
    if (batchAudits.length !== 2) {
      throw new Error(`Expected 2 ENTITLEMENT_EXPIRED audits under concurrent workers, found ${batchAudits.length}`);
    }
    console.log("✓ Gate 18 passed: Concurrent workers expired batch safely with exactly 1 audit per entitlement\n");

    // ----------------------------------------------------
    // Gate 19: Lifetime Invariant (Never Expired)
    // ----------------------------------------------------
    console.log("[Gate 19] Verifying active lifetime entitlement (expiresAt=null) is never expired by worker...");
    const lifeItem = await prisma.orderItem.create({
      data: {
        orderId: order1.id,
        productId: lifetimeVariant.productId,
        variantId: lifetimeVariant.id,
        productName: lifetimeVariant.product.name,
        variantName: lifetimeVariant.name,
        sku: `SKU-LIFE-19-${Date.now()}`,
        productType: ProductType.DOWNLOADABLE_ASSET,
        fulfillmentType: FulfillmentType.DIGITAL_DOWNLOAD,
        unitAmount: 1000,
        quantity: 1,
        lineTotalAmount: 1000,
        currency: Currency.USD,
        isLifetime: true,
      },
    });

    const lifeEnt = await prisma.entitlement.create({
      data: {
        userId: customerUser.id,
        orderId: order1.id,
        orderItemId: lifeItem.id,
        productId: lifetimeVariant.productId,
        variantId: lifetimeVariant.id,
        productType: ProductType.DOWNLOADABLE_ASSET,
        fulfillmentType: FulfillmentType.DIGITAL_DOWNLOAD,
        status: EntitlementStatus.ACTIVE,
        quantity: 1,
        activatedAt: new Date(Date.now() - 365 * 86400000),
        expiresAt: null,
      },
    });

    // Wait a couple worker ticks
    await sleep(1500);

    const checkLife = await prisma.entitlement.findUnique({ where: { id: lifeEnt.id } });
    if (checkLife?.status !== EntitlementStatus.ACTIVE) {
      throw new Error(`Lifetime entitlement was incorrectly expired! status=${checkLife?.status}`);
    }
    console.log("✓ Gate 19 passed: Lifetime entitlement remains ACTIVE indefinitely\n");

    // ----------------------------------------------------
    // Gate 20: Deterministic UTC Month-End Clamping & Precedence
    // ----------------------------------------------------
    console.log("[Gate 20] Verifying deterministic UTC month addition & policy precedence...");
    // 1. Non-leap year Jan 31 -> Feb 28
    const jan31_2025 = new Date("2025-01-31T12:00:00.000Z");
    const feb28_2025 = addUtcMonths(jan31_2025, 1);
    if (feb28_2025.toISOString() !== "2025-02-28T12:00:00.000Z") {
      throw new Error(`Expected 2025-02-28, got: ${feb28_2025.toISOString()}`);
    }

    // 2. Leap year Jan 31 -> Feb 29
    const jan31_2024 = new Date("2024-01-31T12:00:00.000Z");
    const feb29_2024 = addUtcMonths(jan31_2024, 1);
    if (feb29_2024.toISOString() !== "2024-02-29T12:00:00.000Z") {
      throw new Error(`Expected 2024-02-29, got: ${feb29_2024.toISOString()}`);
    }

    // 3. 31-day to 30-day month Aug 31 -> Sep 30
    const aug31_2026 = new Date("2026-08-31T08:00:00.000Z");
    const sep30_2026 = addUtcMonths(aug31_2026, 1);
    if (sep30_2026.toISOString() !== "2026-09-30T08:00:00.000Z") {
      throw new Error(`Expected 2026-09-30, got: ${sep30_2026.toISOString()}`);
    }

    // 4. Precedence: isLifetime overrides durationDays & durationMonths
    const precLifetime = calculateExpirationDate(aug31_2026, {
      isLifetime: true,
      durationDays: 30,
      durationMonths: 1,
    });
    if (precLifetime !== null) {
      throw new Error(`Expected null for lifetime precedence, got: ${precLifetime}`);
    }

    // 5. Precedence: durationDays overrides durationMonths
    const precDays = calculateExpirationDate(aug31_2026, {
      isLifetime: false,
      durationDays: 7,
      durationMonths: 2,
    });
    if (precDays?.toISOString() !== "2026-09-07T08:00:00.000Z") {
      throw new Error(`Expected 2026-09-07 for durationDays precedence, got: ${precDays?.toISOString()}`);
    }
    console.log("✓ Gate 20 passed: Deterministic UTC calendar month clamping and policy precedence verified\n");

    console.log("==================================================");
    console.log("ALL 20 PHASE 5 GATES PASSED SUCCESSFULLY!");
    console.log("==================================================");
  } finally {
    if (worker1Process) {
      worker1Process.kill("SIGTERM");
    }
    if (worker2Process) {
      worker2Process.kill("SIGTERM");
    }
    if (apiProcess) {
      apiProcess.kill("SIGTERM");
    }
    await prisma.$disconnect();
  }
}

runAcceptance()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ PHASE 5 ACCEPTANCE FAILED:", err);
    process.exit(1);
  });
