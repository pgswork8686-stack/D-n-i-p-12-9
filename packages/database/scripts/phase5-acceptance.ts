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
  console.log("PHASE 5 — ENTITLEMENT ENGINE LIVE RUNTIME ACCEPTANCE (ROUND 4 — 30 GATES)");
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

    if (item1.snapshotVersion !== 1 || item1.isLifetime !== true || item1.durationDays !== null) {
      throw new Error(`Item 1 snapshot invalid: snapshotVersion=${item1.snapshotVersion}, isLifetime=${item1.isLifetime}, durationDays=${item1.durationDays}`);
    }
    if (item2.snapshotVersion !== 1 || item2.isLifetime !== false || item2.durationDays !== 30 || item2.maxActivations !== expiringPlan.maxActivations) {
      throw new Error(`Item 2 snapshot invalid: snapshotVersion=${item2.snapshotVersion}, isLifetime=${item2.isLifetime}, durationDays=${item2.durationDays}, maxActivations=${item2.maxActivations}`);
    }
    console.log("✓ Gate 2 passed: Policy snapshot captured directly in OrderItems (snapshotVersion=1)\n");

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
    try {
      if (lifetimeVariant.licensePlanId) {
        await prisma.licensePlan.update({
          where: { id: lifetimeVariant.licensePlanId },
          data: { isLifetime: false, durationDays: 14 },
        });
      }

      // Now pay order 3
      const extEvtId3 = `wh_evt_gate8_${Date.now()}`;
      const sig3 = getTestWebhookSignature({
        externalEventId: extEvtId3,
        paymentId: payment3.id,
        eventType: "payment.succeeded",
      });
      const pay3Res = await fetch(`${API_BASE}/payments/test-callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-signature": sig3 },
        body: JSON.stringify({
          externalEventId: extEvtId3,
          paymentId: payment3.id,
          eventType: "payment.succeeded",
          amount: payment3.amount,
          currency: "USD",
        }),
      });
      if (!pay3Res.ok) throw new Error(`Gate 8 payment webhook failed: ${await pay3Res.text()}`);

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
    } finally {
      // Restore lifetime plan
      if (lifetimeVariant.licensePlanId) {
        await prisma.licensePlan.update({
          where: { id: lifetimeVariant.licensePlanId },
          data: { isLifetime: true, durationDays: null },
        });
      }
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
        snapshotVersion: 1,
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

    const extEvtId5 = `wh_evt_gate11_${Date.now()}`;
    const sig5 = getTestWebhookSignature({
      externalEventId: extEvtId5,
      paymentId: payment5.id,
      eventType: "payment.succeeded",
    });
    const pay5Res = await fetch(`${API_BASE}/payments/test-callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-signature": sig5 },
      body: JSON.stringify({
        externalEventId: extEvtId5,
        paymentId: payment5.id,
        eventType: "payment.succeeded",
        amount: payment5.amount,
        currency: "USD",
      }),
    });
    if (!pay5Res.ok) throw new Error(`Gate 11 payment webhook failed: ${await pay5Res.text()}`);

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
        snapshotVersion: 1,
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
        snapshotVersion: 1,
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
        snapshotVersion: 1,
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

    // ----------------------------------------------------
    // Gate 21: Legacy OrderItem Missing Snapshot Policy Fail-Closed
    // ----------------------------------------------------
    console.log("[Gate 21] Verifying legacy OrderItem missing snapshotVersion fails closed (no silent lifetime conversion)...");
    const legacyOrder = await prisma.order.create({
      data: {
        id: `ord-legacy-${Date.now()}`,
        orderNumber: `ORD-LEGACY-${Date.now()}`,
        userId: customerUser.id,
        currency: Currency.USD,
        status: OrderStatus.PAID,
        subtotalAmount: 1000,
        discountAmount: 0,
        totalAmount: 1000,
      },
    });

    await prisma.orderItem.create({
      data: {
        id: `item-legacy-${Date.now()}`,
        orderId: legacyOrder.id,
        productId: lifetimeVariant.productId,
        variantId: lifetimeVariant.id,
        productName: "Legacy Theme",
        variantName: "Legacy 30-Day",
        sku: `SKU-LEGACY-${Date.now()}`,
        productType: ProductType.LICENSED_SOFTWARE,
        fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
        unitAmount: 1000,
        quantity: 1,
        lineTotalAmount: 1000,
        currency: Currency.USD,
        isLifetime: false,
        durationDays: null,
        durationMonths: null,
        snapshotVersion: null, // Legacy pre-Phase 5 OrderItem
      },
    });

    const legacyOutbox = await prisma.outboxEvent.create({
      data: {
        aggregateType: "Order",
        aggregateId: legacyOrder.id,
        eventType: "ORDER_PAID",
        payload: { orderId: legacyOrder.id },
        status: "PENDING",
      },
    });

    // Wait for worker to attempt processing
    const gate21Start = Date.now();
    let legacyProcessed = null;
    while (Date.now() - gate21Start < 10000) {
      await sleep(300);
      legacyProcessed = await prisma.outboxEvent.findUnique({ where: { id: legacyOutbox.id } });
      if (legacyProcessed && legacyProcessed.retryCount >= 1) break;
    }

    if (!legacyProcessed || legacyProcessed.status === "PROCESSED") {
      throw new Error(`Expected legacy outbox event to fail, but got status=${legacyProcessed?.status}`);
    }
    if (!legacyProcessed.error?.includes("Missing entitlement policy snapshot for legacy OrderItem")) {
      throw new Error(`Unexpected error message for legacy item: ${legacyProcessed.error}`);
    }

    const legacyEnts = await prisma.entitlement.findMany({ where: { orderId: legacyOrder.id } });
    if (legacyEnts.length !== 0) {
      throw new Error(`CRITICAL: Silent entitlement created for legacy OrderItem! count=${legacyEnts.length}`);
    }
    await prisma.outboxEvent.update({
      where: { id: legacyOutbox.id },
      data: { status: "FAILED" },
    });
    console.log("✓ Gate 21 passed: Legacy OrderItem failed closed with explicit error, 0 silent entitlements created\n");

    // ----------------------------------------------------
    // Gate 22: Malformed Finite Plan Policy Fail-Closed
    // ----------------------------------------------------
    console.log("[Gate 22] Verifying malformed finite plan snapshot fails closed...");
    const malformedOrder = await prisma.order.create({
      data: {
        id: `ord-malformed-${Date.now()}`,
        orderNumber: `ORD-MALFORMED-${Date.now()}`,
        userId: customerUser.id,
        currency: Currency.USD,
        status: OrderStatus.PAID,
        subtotalAmount: 1000,
        discountAmount: 0,
        totalAmount: 1000,
      },
    });

    await prisma.orderItem.create({
      data: {
        id: `item-malformed-${Date.now()}`,
        orderId: malformedOrder.id,
        productId: expiringVariant.productId,
        variantId: expiringVariant.id,
        productName: "Malformed Plugin",
        variantName: "Finite No Duration",
        sku: `SKU-MALFORMED-${Date.now()}`,
        productType: ProductType.LICENSED_SOFTWARE,
        fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
        unitAmount: 1000,
        quantity: 1,
        lineTotalAmount: 1000,
        currency: Currency.USD,
        snapshotVersion: 1,
        licensePlanIdAtPurchase: "plan-finite-dummy",
        isLifetime: false,
        durationDays: null,
        durationMonths: null,
      },
    });

    const malformedOutbox = await prisma.outboxEvent.create({
      data: {
        aggregateType: "Order",
        aggregateId: malformedOrder.id,
        eventType: "ORDER_PAID",
        payload: { orderId: malformedOrder.id },
        status: "PENDING",
      },
    });

    const gate22Start = Date.now();
    let malformedProcessed = null;
    while (Date.now() - gate22Start < 10000) {
      await sleep(300);
      malformedProcessed = await prisma.outboxEvent.findUnique({ where: { id: malformedOutbox.id } });
      if (malformedProcessed && malformedProcessed.retryCount >= 1) break;
    }

    if (!malformedProcessed || malformedProcessed.status === "PROCESSED") {
      throw new Error(`Expected malformed snapshot outbox event to fail, but got status=${malformedProcessed?.status}`);
    }
    if (!malformedProcessed.error?.includes("finite license plan requires positive durationDays or durationMonths")) {
      throw new Error(`Unexpected error message for malformed snapshot: ${malformedProcessed.error}`);
    }

    const malformedEnts = await prisma.entitlement.findMany({ where: { orderId: malformedOrder.id } });
    if (malformedEnts.length !== 0) {
      throw new Error(`CRITICAL: Entitlement created for malformed snapshot! count=${malformedEnts.length}`);
    }
    await prisma.outboxEvent.update({
      where: { id: malformedOutbox.id },
      data: { status: "FAILED" },
    });
    console.log("✓ Gate 22 passed: Malformed finite plan snapshot failed closed with policy validation error\n");

    // ----------------------------------------------------
    // Gate 23: ORDER_PAID Missing Order Fail-Closed
    // ----------------------------------------------------
    console.log("[Gate 23] Verifying ORDER_PAID event for non-existent order fails closed...");
    const missingOrderId = `ord-missing-${Date.now()}`;
    const missingOutbox = await prisma.outboxEvent.create({
      data: {
        aggregateType: "Order",
        aggregateId: missingOrderId,
        eventType: "ORDER_PAID",
        payload: { orderId: missingOrderId },
        status: "PENDING",
      },
    });

    const gate23Start = Date.now();
    let missingProcessed = null;
    while (Date.now() - gate23Start < 10000) {
      await sleep(300);
      missingProcessed = await prisma.outboxEvent.findUnique({ where: { id: missingOutbox.id } });
      if (missingProcessed && missingProcessed.retryCount >= 1) break;
    }

    if (!missingProcessed || missingProcessed.status === "PROCESSED") {
      throw new Error(`Expected missing order outbox event to fail, but got status=${missingProcessed?.status}`);
    }
    if (!missingProcessed.error?.includes(`Order '${missingOrderId}' not found`)) {
      throw new Error(`Unexpected error message for missing order: ${missingProcessed.error}`);
    }
    await prisma.outboxEvent.update({
      where: { id: missingOutbox.id },
      data: { status: "FAILED" },
    });
    console.log("✓ Gate 23 passed: Missing order outbox event failed closed, retrying with error logged\n");

    // ----------------------------------------------------
    // Gate 24: AggregateId / Payload Mismatch Fail-Closed
    // ----------------------------------------------------
    console.log("[Gate 24] Verifying payload.orderId mismatch with aggregateId fails closed...");
    const mismatchOutbox = await prisma.outboxEvent.create({
      data: {
        aggregateType: "Order",
        aggregateId: order1.id,
        eventType: "ORDER_PAID",
        payload: { orderId: "tampered-order-id-xyz" },
        status: "PENDING",
      },
    });

    const gate24Start = Date.now();
    let mismatchProcessed = null;
    while (Date.now() - gate24Start < 10000) {
      await sleep(300);
      mismatchProcessed = await prisma.outboxEvent.findUnique({ where: { id: mismatchOutbox.id } });
      if (mismatchProcessed && mismatchProcessed.retryCount >= 1) break;
    }

    if (!mismatchProcessed || mismatchProcessed.status === "PROCESSED") {
      throw new Error(`Expected mismatched payload outbox event to fail, but got status=${mismatchProcessed?.status}`);
    }
    if (!mismatchProcessed.error?.includes("does not match aggregateId")) {
      throw new Error(`Unexpected error message for payload mismatch: ${mismatchProcessed.error}`);
    }
    await prisma.outboxEvent.update({
      where: { id: mismatchOutbox.id },
      data: { status: "FAILED" },
    });
    console.log("✓ Gate 24 passed: Tampered payload orderId rejected with mismatch error\n");

    // ----------------------------------------------------
    // Gate 25: Transaction Rollback Atomicity on Domain / Audit Failure
    // ----------------------------------------------------
    console.log("[Gate 25] Verifying transaction rollback atomicity when issuance fails...");
    const rollbackOrder = await prisma.order.create({
      data: {
        id: `ord-rollback-${Date.now()}`,
        orderNumber: `ORD-RB-${Date.now()}`,
        userId: customerUser.id,
        currency: Currency.USD,
        status: OrderStatus.PAID,
        subtotalAmount: 1000,
        discountAmount: 0,
        totalAmount: 1000,
      },
    });

    await prisma.orderItem.create({
      data: {
        id: `item-rb-${Date.now()}`,
        orderId: rollbackOrder.id,
        productId: lifetimeVariant.productId,
        variantId: lifetimeVariant.id,
        productName: "Rollback Theme",
        variantName: "Standard",
        sku: `SKU-RB-${Date.now()}`,
        productType: ProductType.DOWNLOADABLE_ASSET,
        fulfillmentType: FulfillmentType.DIGITAL_DOWNLOAD,
        unitAmount: 1000,
        quantity: 1,
        lineTotalAmount: 1000,
        currency: Currency.USD,
        isLifetime: true,
        snapshotVersion: 1,
      },
    });

    let rollbackCaught = false;
    try {
      await prisma.$transaction(async (tx) => {
        // Issue entitlements inside transaction
        await issueEntitlementsForOrder(rollbackOrder.id, tx);
        // Force transaction failure (e.g. audit log or downstream constraint failure)
        throw new Error("Simulated audit/transaction failure for Gate 25");
      });
    } catch (err: any) {
      if (err.message?.includes("Simulated audit/transaction failure")) {
        rollbackCaught = true;
      }
    }

    if (!rollbackCaught) {
      throw new Error("Transaction did not throw expected simulated failure");
    }

    const rollbackEnts = await prisma.entitlement.findMany({ where: { orderId: rollbackOrder.id } });
    if (rollbackEnts.length !== 0) {
      throw new Error(`CRITICAL: Transaction failed to roll back! Found ${rollbackEnts.length} orphan entitlements.`);
    }
    console.log("✓ Gate 25 passed: Transaction atomic rollback verified, 0 orphan entitlements committed\n");

    // ----------------------------------------------------
    // Gate 26: Database Schema & Migration Drift Verification
    // ----------------------------------------------------
    console.log("[Gate 26] Verifying database schema columns & indexes...");
    const colCheck = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'order_items' AND column_name IN ('snapshot_version', 'updates_days', 'support_days')
    `;
    const colNames = colCheck.map((c) => c.column_name);
    if (!colNames.includes("snapshot_version") || !colNames.includes("updates_days") || !colNames.includes("support_days")) {
      throw new Error(`Schema drift: OrderItem missing required snapshot columns: ${JSON.stringify(colNames)}`);
    }

    const entColCheck = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'entitlements' AND column_name IN ('max_activations', 'updates_until', 'support_until')
    `;
    const entColNames = entColCheck.map((c) => c.column_name);
    if (!entColNames.includes("max_activations") || !entColNames.includes("updates_until") || !entColNames.includes("support_until")) {
      throw new Error(`Schema drift: Entitlement missing typed rights columns: ${JSON.stringify(entColNames)}`);
    }

    const idxCheck = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'entitlements' AND indexname = 'entitlements_status_expires_at_idx'
    `;
    if (idxCheck.length === 0) {
      throw new Error("Schema drift: Index 'entitlements_status_expires_at_idx' not found on 'entitlements' table");
    }
    console.log("✓ Gate 26 passed: Schema verified: snapshot columns, typed rights columns, and composite index present\n");

    // ----------------------------------------------------
    // Gate 27: Immutable Purchase Snapshot Drift Regression
    // ----------------------------------------------------
    console.log("[Gate 27] Verifying updatesDays/supportDays/maxActivations immutable purchase snapshot drift...");
    const driftPlan = await prisma.licensePlan.create({
      data: {
        id: `plan-drift-${Date.now()}`,
        name: "Drift Test 365D Plan",
        durationDays: 365,
        maxActivations: 3,
        updatesDays: 365,
        supportDays: 180,
        isLifetime: false,
      },
    });

    const activeProduct = await prisma.product.findFirst({ where: { status: "ACTIVE" } });
    if (!activeProduct) throw new Error("No active product found for Gate 27");

    const driftVariant = await prisma.productVariant.create({
      data: {
        id: `var-drift-${Date.now()}`,
        productId: activeProduct.id,
        sku: `SKU-DRIFT-${Date.now()}`,
        name: "Drift Test Variant",
        status: "ACTIVE",
        licensePlanId: driftPlan.id,
      },
    });

    await prisma.productPrice.create({
      data: {
        variantId: driftVariant.id,
        currency: Currency.USD,
        amount: 2500,
        billingType: "ONE_TIME",
        isActive: true,
      },
    });

    // Customer 1 checkouts with driftVariant
    await fetch(`${API_BASE}/cart`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    await fetch(`${API_BASE}/cart/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({ variantId: driftVariant.id, quantity: 1, currency: "USD" }),
    });

    const driftCheckoutRes = await fetch(`${API_BASE}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({ currency: "USD" }),
    });
    if (!driftCheckoutRes.ok) throw new Error(`Gate 27 checkout failed: ${driftCheckoutRes.status}`);
    const driftCheckoutData: any = await driftCheckoutRes.json();
    const driftOrderId = driftCheckoutData.order.id;

    // Verify OrderItem snapshot is exact immediately after checkout
    const driftOrderItem = await prisma.orderItem.findFirst({
      where: { orderId: driftOrderId },
    });
    if (!driftOrderItem) throw new Error("Gate 27 OrderItem not found in DB");
    if (
      driftOrderItem.durationDays !== 365 ||
      driftOrderItem.maxActivations !== 3 ||
      driftOrderItem.updatesDays !== 365 ||
      driftOrderItem.supportDays !== 180 ||
      driftOrderItem.snapshotVersion !== 1
    ) {
      throw new Error(`Gate 27 OrderItem snapshot mismatch: ${JSON.stringify(driftOrderItem)}`);
    }

    // Mutate catalog LicensePlan BEFORE payment / worker runs!
    await prisma.licensePlan.update({
      where: { id: driftPlan.id },
      data: {
        durationDays: 30,
        maxActivations: 1,
        updatesDays: 30,
        supportDays: 7,
      },
    });

    // Pay order via webhook callback
    const driftPayment = driftCheckoutData.payment;
    const paymentCallbackPayload = {
      paymentId: driftPayment.id,
      externalEventId: `evt_drift_${Date.now()}`,
      eventType: "payment.succeeded",
      amount: driftPayment.amount,
      currency: "USD",
    };
    const driftSig = getTestWebhookSignature(paymentCallbackPayload);
    const cbRes = await fetch(`${API_BASE}/payments/test-callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-signature": driftSig,
      },
      body: JSON.stringify(paymentCallbackPayload),
    });
    if (!cbRes.ok) throw new Error(`Gate 27 payment callback failed: ${await cbRes.text()}`);

    // Wait for worker to issue entitlement via ORDER_PAID outbox
    const g27Start = Date.now();
    let driftEnt = null;
    while (Date.now() - g27Start < 15000) {
      await sleep(300);
      driftEnt = await prisma.entitlement.findUnique({
        where: { orderItemId: driftOrderItem.id },
      });
      if (driftEnt) break;
    }
    if (!driftEnt) throw new Error("Timed out waiting for worker to issue Gate 27 entitlement");

    // Verify entitlement retains exact purchased snapshot rights, NOT newly mutated catalog values!
    if (driftEnt.maxActivations !== 3) {
      throw new Error(`Gate 27 expected maxActivations=3 from snapshot, but got ${driftEnt.maxActivations} (catalog was mutated to 1)`);
    }
    if (!driftEnt.expiresAt) throw new Error("Gate 27 expected non-null expiresAt");
    const expDiffDays = Math.round((driftEnt.expiresAt.getTime() - driftEnt.activatedAt.getTime()) / 86400000);
    if (expDiffDays !== 365) {
      throw new Error(`Gate 27 expected expiresAt ~365 days, but got ${expDiffDays} days (catalog was mutated to 30)`);
    }
    if (!driftEnt.updatesUntil) throw new Error("Gate 27 expected non-null updatesUntil");
    const updDiffDays = Math.round((driftEnt.updatesUntil.getTime() - driftEnt.activatedAt.getTime()) / 86400000);
    if (updDiffDays !== 365) {
      throw new Error(`Gate 27 expected updatesUntil ~365 days, but got ${updDiffDays} days (catalog was mutated to 30)`);
    }
    if (!driftEnt.supportUntil) throw new Error("Gate 27 expected non-null supportUntil");
    const supDiffDays = Math.round((driftEnt.supportUntil.getTime() - driftEnt.activatedAt.getTime()) / 86400000);
    if (supDiffDays !== 180) {
      throw new Error(`Gate 27 expected supportUntil ~180 days, but got ${supDiffDays} days (catalog was mutated to 7)`);
    }
    console.log("✓ Gate 27 passed: Catalog mutation ignored; entitlement issued with exact purchased snapshot rights\n");

    // ----------------------------------------------------
    // Gate 28: Unsupported Snapshot Version Fails Closed
    // ----------------------------------------------------
    console.log("[Gate 28] Verifying unsupported snapshotVersion (e.g. 99) fails closed...");
    const unsupportedOrder = await prisma.order.create({
      data: {
        id: `ord-v99-${Date.now()}`,
        orderNumber: `ORD-V99-${Date.now()}`,
        userId: customerUser.id,
        currency: Currency.USD,
        status: OrderStatus.PAID,
        subtotalAmount: 1000,
        discountAmount: 0,
        totalAmount: 1000,
      },
    });

    const unsupportedItem = await prisma.orderItem.create({
      data: {
        id: `item-v99-${Date.now()}`,
        orderId: unsupportedOrder.id,
        productId: activeProduct.id,
        variantId: driftVariant.id,
        productName: "Future Version Theme",
        variantName: "Standard",
        sku: `SKU-V99-${Date.now()}`,
        productType: ProductType.DOWNLOADABLE_ASSET,
        fulfillmentType: FulfillmentType.DIGITAL_DOWNLOAD,
        unitAmount: 1000,
        quantity: 1,
        lineTotalAmount: 1000,
        currency: Currency.USD,
        isLifetime: true,
        snapshotVersion: 99, // UNSUPPORTED FUTURE VERSION
      },
    });

    const v99Outbox = await prisma.outboxEvent.create({
      data: {
        aggregateType: "Order",
        aggregateId: unsupportedOrder.id,
        eventType: "ORDER_PAID",
        payload: { orderId: unsupportedOrder.id },
        status: "PENDING",
      },
    });

    const g28Start = Date.now();
    let v99Processed = null;
    while (Date.now() - g28Start < 10000) {
      await sleep(300);
      v99Processed = await prisma.outboxEvent.findUnique({ where: { id: v99Outbox.id } });
      if (v99Processed && v99Processed.retryCount >= 1) break;
    }
    if (!v99Processed || v99Processed.status === "PROCESSED") {
      throw new Error(`Expected unsupported snapshotVersion event to fail, but got status=${v99Processed?.status}`);
    }
    if (!v99Processed.error?.includes("Unsupported entitlement policy snapshot version '99'")) {
      throw new Error(`Unexpected error message for snapshotVersion=99: ${v99Processed.error}`);
    }
    const v99Ents = await prisma.entitlement.findMany({ where: { orderItemId: unsupportedItem.id } });
    if (v99Ents.length !== 0) {
      throw new Error(`Expected 0 entitlements for unsupported version, found ${v99Ents.length}`);
    }
    await prisma.outboxEvent.update({
      where: { id: v99Outbox.id },
      data: { status: "FAILED" },
    });
    console.log("✓ Gate 28 passed: Unsupported snapshotVersion=99 failed closed, outbox logged error\n");

    // ----------------------------------------------------
    // Gate 29: Malformed Rights (updatesDays/supportDays/maxActivations) Fail Closed
    // ----------------------------------------------------
    console.log("[Gate 29] Verifying malformed updatesDays/supportDays/maxActivations fail closed...");
    const malformedRightsOrder = await prisma.order.create({
      data: {
        id: `ord-malformed-rights-${Date.now()}`,
        orderNumber: `ORD-MAL-R-${Date.now()}`,
        userId: customerUser.id,
        currency: Currency.USD,
        status: OrderStatus.PAID,
        subtotalAmount: 1000,
        discountAmount: 0,
        totalAmount: 1000,
      },
    });

    const malformedItem = await prisma.orderItem.create({
      data: {
        id: `item-malformed-rights-${Date.now()}`,
        orderId: malformedRightsOrder.id,
        productId: activeProduct.id,
        variantId: driftVariant.id,
        productName: "Malformed Rights Theme",
        variantName: "Standard",
        sku: `SKU-MAL-R-${Date.now()}`,
        productType: ProductType.DOWNLOADABLE_ASSET,
        fulfillmentType: FulfillmentType.DIGITAL_DOWNLOAD,
        unitAmount: 1000,
        quantity: 1,
        lineTotalAmount: 1000,
        currency: Currency.USD,
        isLifetime: false,
        durationDays: 30,
        licensePlanIdAtPurchase: "plan-malformed",
        maxActivations: -1, // MALFORMED negative
        updatesDays: 0,    // MALFORMED zero
        supportDays: -5,   // MALFORMED negative
        snapshotVersion: 1,
      },
    });

    const malOutbox = await prisma.outboxEvent.create({
      data: {
        aggregateType: "Order",
        aggregateId: malformedRightsOrder.id,
        eventType: "ORDER_PAID",
        payload: { orderId: malformedRightsOrder.id },
        status: "PENDING",
      },
    });

    const g29Start = Date.now();
    let malProcessed = null;
    while (Date.now() - g29Start < 10000) {
      await sleep(300);
      malProcessed = await prisma.outboxEvent.findUnique({ where: { id: malOutbox.id } });
      if (malProcessed && malProcessed.retryCount >= 1) break;
    }
    if (!malProcessed || malProcessed.status === "PROCESSED") {
      throw new Error(`Expected malformed rights event to fail, but got status=${malProcessed?.status}`);
    }
    if (!malProcessed.error?.includes("Malformed entitlement policy snapshot for OrderItem")) {
      throw new Error(`Unexpected error message for malformed rights: ${malProcessed.error}`);
    }
    const malEnts = await prisma.entitlement.findMany({ where: { orderItemId: malformedItem.id } });
    if (malEnts.length !== 0) {
      throw new Error(`Expected 0 entitlements for malformed rights, found ${malEnts.length}`);
    }
    await prisma.outboxEvent.update({
      where: { id: malOutbox.id },
      data: { status: "FAILED" },
    });
    console.log("✓ Gate 29 passed: Malformed rights values rejected; 0 corrupted entitlements created\n");

    // ----------------------------------------------------
    // Gate 30: Entitlement API Returns Typed Purchased-Right Values
    // ----------------------------------------------------
    console.log("[Gate 30] Verifying Entitlement API returns typed purchased-right values correctly...");
    const customerEntRes = await fetch(`${API_BASE}/entitlements/${driftEnt.id}`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    if (!customerEntRes.ok) {
      throw new Error(`Customer GET /entitlements/${driftEnt.id} failed: ${customerEntRes.status}`);
    }
    const customerEntData: any = await customerEntRes.json();
    if (customerEntData.maxActivations !== 3) {
      throw new Error(`Customer API expected maxActivations=3, got ${customerEntData.maxActivations}`);
    }
    if (!customerEntData.updatesUntil || typeof customerEntData.updatesUntil !== "string") {
      throw new Error(`Customer API expected updatesUntil ISO string, got ${customerEntData.updatesUntil}`);
    }
    if (!customerEntData.supportUntil || typeof customerEntData.supportUntil !== "string") {
      throw new Error(`Customer API expected supportUntil ISO string, got ${customerEntData.supportUntil}`);
    }
    if (!customerEntData.expiresAt || typeof customerEntData.expiresAt !== "string") {
      throw new Error(`Customer API expected expiresAt ISO string, got ${customerEntData.expiresAt}`);
    }

    const adminEntRes = await fetch(`${API_BASE}/admin/entitlements/${driftEnt.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!adminEntRes.ok) {
      throw new Error(`Admin GET /admin/entitlements/${driftEnt.id} failed: ${adminEntRes.status}`);
    }
    const adminEntData: any = await adminEntRes.json();
    if (adminEntData.maxActivations !== 3) {
      throw new Error(`Admin API expected maxActivations=3, got ${adminEntData.maxActivations}`);
    }
    if (!adminEntData.updatesUntil || !adminEntData.supportUntil) {
      throw new Error("Admin API missing typed rights in response");
    }
    console.log("✓ Gate 30 passed: Customer & Admin APIs return authoritative typed rights (maxActivations, updatesUntil, supportUntil)\n");

    console.log("==================================================");
    console.log("ALL 30 PHASE 5 GATES PASSED SUCCESSFULLY!");
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
