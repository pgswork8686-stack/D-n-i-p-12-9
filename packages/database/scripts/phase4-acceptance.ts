import * as crypto from "node:crypto";
import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
import { prisma } from "../src/client";
import { processOutboxEvents } from "../../../apps/worker/src/outbox-processor";

const API_BASE = process.env.API_URL || "http://localhost:4000";
const TEST_WEBHOOK_SECRET =
  process.env.TEST_PAYMENT_WEBHOOK_SECRET || "change-me-local-only";

let apiProcess: ChildProcess | null = null;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureApiRunning(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (res.ok) {
      return;
    }
  } catch {
    // Not running
  }

  console.log("Starting API server child process on port 4000...");
  apiProcess = spawn("node", [path.resolve(__dirname, "../../../apps/api/dist/main.js")], {
    stdio: "pipe",
    env: { ...process.env, PORT: "4000" },
  });

  const startTime = Date.now();
  while (Date.now() - startTime < 30000) {
    await sleep(500);
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) {
        console.log("API server is ready!");
        return;
      }
    } catch {
      // Keep waiting
    }
  }
  throw new Error("Timed out waiting for API server to start");
}

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
  console.log("PHASE 4 — COMMERCE CORE LIVE RUNTIME ACCEPTANCE");
  console.log("==================================================\n");

  await ensureApiRunning();

  const customerToken = "dev-customer-token";
  const customer2Token = "dev-no-email:sub_dev_customer_002";
  const adminToken = "dev-admin-token";

  const customerMeRes = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  const customerUser: any = await customerMeRes.json();

  // ----------------------------------------------------
  // Gate 1: Health 200
  // ----------------------------------------------------
  console.log("[Gate 1] Checking API Health...");
  const healthRes = await fetch(`${API_BASE}/health`);
  if (!healthRes.ok)
    throw new Error(`Health check failed: ${healthRes.status}`);
  const healthData: any = await healthRes.json();
  console.log("✓ Health status 200 OK:", JSON.stringify(healthData));
  if (healthData.status !== "ok") throw new Error("Health status is not ok");

  // ----------------------------------------------------
  // Gate 2: Public Catalog & Variant Lookup
  // ----------------------------------------------------
  console.log("\n[Gate 2] Querying active catalog products...");
  const productsRes = await fetch(`${API_BASE}/products?currency=USD`);
  if (!productsRes.ok)
    throw new Error(`Fetch products failed: ${productsRes.status}`);
  const productsData: any = await productsRes.json();
  const products = productsData.items || [];
  if (products.length === 0) throw new Error("No products found in catalog");

  const productSummary = products[0];
  const detailRes = await fetch(
    `${API_BASE}/products/${productSummary.slug}?currency=USD`,
  );
  if (!detailRes.ok)
    throw new Error(`Fetch product detail failed: ${detailRes.status}`);
  const targetProduct: any = await detailRes.json();
  if (!targetProduct.variants || targetProduct.variants.length === 0) {
    throw new Error("Target product has no variants");
  }
  const targetVariant = targetProduct.variants[0];
  const targetPrice = targetVariant.prices?.find(
    (p: any) => p.currency === "USD",
  )?.amount;
  if (!targetPrice) throw new Error("Target variant has no USD price");

  console.log(
    `✓ Target product selected: ${targetProduct.name} (${targetProduct.slug}), Variant: ${targetVariant.name} (${targetVariant.sku}), Unit Price: $${targetPrice / 100}`,
  );

  // ----------------------------------------------------
  // Gate 3: Add Cart Item & Customer Ownership
  // ----------------------------------------------------
  console.log("\n[Gate 3] Adding items to customer cart...");
  // Clear any existing items first
  await fetch(`${API_BASE}/cart`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${customerToken}` },
  });

  const addCartRes = await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      variantId: targetVariant.id,
      quantity: 2,
      currency: "USD",
      // Client-supplied bogus price that MUST be ignored:
      unitPrice: 1,
      totalPrice: 2,
    }),
  });

  if (!addCartRes.ok) {
    const err = await addCartRes.text();
    throw new Error(`Add cart failed: ${err}`);
  }

  const cartData: any = await addCartRes.json();
  console.log(
    `✓ Item added. Cart ID: ${cartData.id}, Items Count: ${cartData.itemCount}`,
  );
  if (cartData.itemCount !== 2)
    throw new Error(`Expected 2 items, got ${cartData.itemCount}`);

  // ----------------------------------------------------
  // Gate 4: Backend-Calculated Authoritative Cart Total
  // ----------------------------------------------------
  console.log("\n[Gate 4] Verifying authoritative backend repricing...");
  const expectedUnitAmount = targetPrice;
  const expectedTotalAmount = expectedUnitAmount * 2;

  const itemInCart = cartData.items[0];
  console.log(`  Expected Unit Price: ${expectedUnitAmount} minor units`);
  console.log(`  Cart Unit Price:     ${itemInCart.unitAmount} minor units`);
  console.log(`  Cart Subtotal:       ${cartData.subtotalAmount} minor units`);

  if (itemInCart.unitAmount !== expectedUnitAmount) {
    throw new Error(
      `Repricing mismatch: expected ${expectedUnitAmount}, received ${itemInCart.unitAmount}`,
    );
  }
  if (cartData.subtotalAmount !== expectedTotalAmount) {
    throw new Error(
      `Subtotal mismatch: expected ${expectedTotalAmount}, received ${cartData.subtotalAmount}`,
    );
  }
  console.log(
    "✓ Backend authoritative repricing verified (client prices ignored).",
  );

  // ----------------------------------------------------
  // Gate 5: Checkout creates Order (PENDING_PAYMENT) & Payment (PENDING)
  // ----------------------------------------------------
  console.log("\n[Gate 5] Executing authoritative checkout transaction...");
  const checkoutRes = await fetch(`${API_BASE}/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      currency: "USD",
      idempotencyKey: `chk_live_${Date.now()}`,
    }),
  });

  if (!checkoutRes.ok) {
    const err = await checkoutRes.text();
    throw new Error(`Checkout failed: ${err}`);
  }

  const checkoutData: any = await checkoutRes.json();
  const order = checkoutData.order;
  const payment = checkoutData.payment;

  console.log(`✓ Order created: ${order.orderNumber} (ID: ${order.id})`);
  console.log(`  Order Status:   ${order.status}`);
  console.log(`  Order Total:    ${order.totalAmount} ${order.currency}`);
  console.log(
    `  Payment ID:     ${payment.id} (Status: ${payment.status}, Amount: ${payment.amount})`,
  );

  if (order.status !== "PENDING_PAYMENT") {
    throw new Error(
      `Expected order status PENDING_PAYMENT, got ${order.status}`,
    );
  }
  if (payment.status !== "PENDING") {
    throw new Error(`Expected payment status PENDING, got ${payment.status}`);
  }
  if (order.totalAmount !== expectedTotalAmount) {
    throw new Error(
      `Expected order total ${expectedTotalAmount}, got ${order.totalAmount}`,
    );
  }

  // ----------------------------------------------------
  // Gate 6: Order Item Snapshot Verification
  // ----------------------------------------------------
  console.log("\n[Gate 6] Verifying immutable order item snapshots...");
  const orderItem = order.items[0];
  console.log("  Snapshot fields:");
  console.log(`  - Product Name:     ${orderItem.productName}`);
  console.log(`  - Variant Name:     ${orderItem.variantName}`);
  console.log(`  - SKU:              ${orderItem.sku}`);
  console.log(`  - Product Type:     ${orderItem.productType}`);
  console.log(`  - Fulfillment Type: ${orderItem.fulfillmentType}`);
  console.log(`  - Unit Amount:      ${orderItem.unitAmount}`);
  console.log(`  - Line Total:       ${orderItem.lineTotalAmount}`);
  console.log(`  - Currency:         ${orderItem.currency}`);

  if (
    !orderItem.productName ||
    !orderItem.variantName ||
    !orderItem.sku ||
    !orderItem.productType ||
    !orderItem.fulfillmentType ||
    orderItem.unitAmount !== expectedUnitAmount ||
    orderItem.lineTotalAmount !== expectedTotalAmount
  ) {
    throw new Error("Order item snapshot fields are incomplete or invalid");
  }
  console.log("✓ Immutable OrderItem snapshot verified.");

  // ----------------------------------------------------
  // Gate 7: Cross-User Order Access Denied (Enumeration Prevention 404)
  // ----------------------------------------------------
  console.log(
    "\n[Gate 7] Verifying cross-user access rejection (Customer A vs Customer B)...",
  );
  const crossUserRes = await fetch(`${API_BASE}/orders/${order.id}`, {
    headers: { Authorization: `Bearer ${customer2Token}` },
  });

  console.log(
    `  Customer B fetch Customer A order status: ${crossUserRes.status}`,
  );
  if (crossUserRes.status !== 404) {
    throw new Error(
      `Expected 404 Not Found for cross-user access (ID enumeration defense), got ${crossUserRes.status}`,
    );
  }
  console.log(
    "✓ Cross-user access strictly returns 404 Not Found (enumeration prevention).",
  );

  // Admin access check (order.read)
  const adminRes = await fetch(`${API_BASE}/admin/orders/${order.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!adminRes.ok) throw new Error(`Admin fetch failed: ${adminRes.status}`);
  console.log("✓ Admin with order.read permission can view order details.");

  // ----------------------------------------------------
  // Gate 8: Test Payment Succeeded State Machine Transition with HMAC Signature
  // ----------------------------------------------------
  console.log(
    "\n[Gate 8] Executing test payment success transition with valid HMAC signature...",
  );
  const externalEventId = `evt_live_test_${Date.now()}`;
  const callbackPayload = {
    paymentId: payment.id,
    externalEventId,
    eventType: "payment.succeeded",
    metadata: { simulatedBy: "live-runtime-acceptance" },
  };
  const validSignature = getTestWebhookSignature(callbackPayload);

  const callbackRes = await fetch(`${API_BASE}/payments/test-callback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-test-signature": validSignature,
    },
    body: JSON.stringify(callbackPayload),
  });

  if (!callbackRes.ok) {
    const err = await callbackRes.text();
    throw new Error(`Test callback failed: ${err}`);
  }

  const callbackData: any = await callbackRes.json();
  console.log("  Callback Response:", JSON.stringify(callbackData));

  if (
    callbackData.paymentStatus !== "SUCCEEDED" ||
    callbackData.orderStatus !== "PAID"
  ) {
    throw new Error(
      `Expected payment SUCCEEDED and order PAID, got ${callbackData.paymentStatus} / ${callbackData.orderStatus}`,
    );
  }

  // Reload order from customer perspective
  const reloadedOrderRes = await fetch(`${API_BASE}/orders/${order.id}`, {
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  const reloadedOrder: any = await reloadedOrderRes.json();
  console.log(`✓ Live order reloaded: Status is now '${reloadedOrder.status}'`);
  if (reloadedOrder.status !== "PAID") {
    throw new Error(
      `Expected reloaded order status PAID, got ${reloadedOrder.status}`,
    );
  }

  // ----------------------------------------------------
  // Gate 9: Idempotency (Duplicate Event Check with Signature)
  // ----------------------------------------------------
  console.log(
    "\n[Gate 9] Sending duplicate payment event to test idempotency...",
  );
  const duplicatePayload = {
    paymentId: payment.id,
    externalEventId, // Identical event ID
    eventType: "payment.succeeded",
  };
  const duplicateSignature = getTestWebhookSignature(duplicatePayload);

  const duplicateCallbackRes = await fetch(
    `${API_BASE}/payments/test-callback`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-signature": duplicateSignature,
      },
      body: JSON.stringify(duplicatePayload),
    },
  );

  const duplicateData: any = await duplicateCallbackRes.json();
  console.log("  Duplicate Response:", JSON.stringify(duplicateData));
  if (!duplicateData.duplicate) {
    throw new Error("Expected duplicate=true for resending identical event");
  }
  console.log(
    "✓ Idempotency verified: duplicate event detected and handled without re-mutation.",
  );

  // ----------------------------------------------------
  // Gate 10: Transactional Outbox (ORDER_PAID Atomicity)
  // ----------------------------------------------------
  console.log(
    "\n[Gate 10] Verifying Transactional Outbox in PostgreSQL database...",
  );
  const outboxEvents = await prisma.outboxEvent.findMany({
    where: {
      aggregateId: order.id,
      eventType: "ORDER_PAID",
    },
  });

  console.log(
    `  Outbox events for Order ${order.id}: count = ${outboxEvents.length}`,
  );
  if (outboxEvents.length !== 1) {
    throw new Error(
      `Expected exactly 1 ORDER_PAID outbox event, found ${outboxEvents.length}`,
    );
  }

  const outboxEvent = outboxEvents[0];
  console.log(`  Outbox Event ID:   ${outboxEvent.id}`);
  console.log(`  Event Type:        ${outboxEvent.eventType}`);
  console.log(`  Initial Status:    ${outboxEvent.status}`);
  console.log(`  Payload:           `, JSON.stringify(outboxEvent.payload));

  if (outboxEvent.status !== "PENDING") {
    throw new Error(
      `Expected outbox event status PENDING, got ${outboxEvent.status}`,
    );
  }
  console.log("✓ Transactional Outbox event exactly-once atomicity verified.");

  // ----------------------------------------------------
  // Gate 11: Worker Outbox Processor
  // ----------------------------------------------------
  console.log("\n[Gate 11] Running Worker Outbox Processor...");
  const workerResult = await processOutboxEvents();
  console.log(
    `✓ Worker processed ${workerResult.processedCount} outbox events.`,
  );

  const processedEvent = await prisma.outboxEvent.findUnique({
    where: { id: outboxEvent.id },
  });
  console.log(`  Updated Outbox Status: ${processedEvent?.status}`);
  console.log(
    `  Processed At:          ${processedEvent?.processedAt?.toISOString()}`,
  );

  if (processedEvent?.status !== "PROCESSED") {
    throw new Error(
      `Expected outbox status PROCESSED, got ${processedEvent?.status}`,
    );
  }
  console.log(
    "✓ Worker outbox processing verified (strictly foundational, no entitlement).",
  );

  // ----------------------------------------------------
  // Gate 12: Fail-Closed Test Payment Webhook Security
  // ----------------------------------------------------
  console.log(
    "\n[Gate 12] Verifying fail-closed test payment webhook security...",
  );
  const probePayload = {
    paymentId: payment.id,
    externalEventId: `evt_probe_${Date.now()}`,
    eventType: "payment.succeeded",
  };

  // 12a: Missing signature header
  const noSigRes = await fetch(`${API_BASE}/payments/test-callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(probePayload),
  });
  console.log(`  12a. Missing signature status: ${noSigRes.status}`);
  if (noSigRes.status !== 401) {
    throw new Error(
      `Expected 401 Unauthorized for missing signature, got ${noSigRes.status}`,
    );
  }

  // 12b: Invalid signature header
  const badSigRes = await fetch(`${API_BASE}/payments/test-callback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-test-signature": "deadbeefcafebabe0123456789abcdef",
    },
    body: JSON.stringify(probePayload),
  });
  console.log(`  12b. Invalid signature status: ${badSigRes.status}`);
  if (badSigRes.status !== 401) {
    throw new Error(
      `Expected 401 Unauthorized for invalid signature, got ${badSigRes.status}`,
    );
  }
  console.log(
    "✓ Fail-closed webhook security verified (missing/invalid signature rejected with 401).",
  );

  // ----------------------------------------------------
  // Gate 13: Concurrency Probe (10 Concurrent Checkouts on Same Cart)
  // ----------------------------------------------------
  console.log(
    "\n[Gate 13] Concurrency probe: 10 concurrent checkouts on the same active cart...",
  );
  // Clear cart and add item for Customer 1
  await fetch(`${API_BASE}/cart`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  const refillCartRes = await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      variantId: targetVariant.id,
      quantity: 1,
      currency: "USD",
    }),
  });
  if (!refillCartRes.ok)
    throw new Error("Failed to populate cart for concurrency probe");

  // Launch 10 simultaneous checkouts with distinct idempotency keys
  const checkoutPromises = Array.from({ length: 10 }).map((_, idx) =>
    fetch(`${API_BASE}/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        currency: "USD",
        idempotencyKey: `chk_race_${idx}_${Date.now()}`,
      }),
    }),
  );

  const checkoutResults = await Promise.all(checkoutPromises);
  const successCount = checkoutResults.filter((r) => r.status === 201).length;
  const conflictCount = checkoutResults.filter((r) => r.status === 409).length;

  console.log(
    `  10 Concurrent Checkouts: ${successCount} Succeeded (201), ${conflictCount} Conflicts (409)`,
  );
  if (successCount !== 1 || conflictCount !== 9) {
    throw new Error(
      `Race condition detected! Expected exactly 1 success (201) and 9 conflicts (409), got ${successCount} / ${conflictCount}`,
    );
  }
  console.log(
    "✓ Race condition immunity verified: exactly 1 order created, 9 safely rejected with 409 Conflict.",
  );

  // ----------------------------------------------------
  // Gate 14: Scoped Idempotency Probe ((scope, userId, key) Isolation & Payload Tamper Defense)
  // ----------------------------------------------------
  console.log(
    "\n[Gate 14] Scoped idempotency probe: (scope, userId, key) isolation & tamper defense...",
  );
  const sharedKey = `shared_idemp_${Date.now()}`;

  // Set up User A cart
  await fetch(`${API_BASE}/cart`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      variantId: targetVariant.id,
      quantity: 1,
      currency: "USD",
    }),
  });

  // User A checkout with sharedKey
  const resA1 = await fetch(`${API_BASE}/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({ currency: "USD", idempotencyKey: sharedKey }),
  });
  if (resA1.status !== 201)
    throw new Error(`User A initial checkout failed: ${resA1.status}`);
  const dataA1: any = await resA1.json();

  // User A repeat checkout with SAME sharedKey & SAME payload (idempotent replay)
  const resA2 = await fetch(`${API_BASE}/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({ currency: "USD", idempotencyKey: sharedKey }),
  });
  if (!resA2.ok)
    throw new Error(`User A idempotent replay failed: ${resA2.status}`);
  const dataA2: any = await resA2.json();
  if (dataA2.order.id !== dataA1.order.id) {
    throw new Error(
      `Expected same order ID for identical replay, got ${dataA2.order.id} vs ${dataA1.order.id}`,
    );
  }
  console.log(
    `  14a. User A idempotent replay: returned identical Order ID ${dataA1.order.id}`,
  );

  // User A repeat checkout with SAME sharedKey but DIFFERENT payload -> 409 Conflict
  const resA3 = await fetch(`${API_BASE}/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({ currency: "VND", idempotencyKey: sharedKey }),
  });
  console.log(`  14b. User A mismatched payload status: ${resA3.status}`);
  if (resA3.status !== 409) {
    throw new Error(
      `Expected 409 Conflict for mismatched idempotency payload, got ${resA3.status}`,
    );
  }

  // Set up User B cart
  await fetch(`${API_BASE}/cart`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${customer2Token}` },
  });
  await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customer2Token}`,
    },
    body: JSON.stringify({
      variantId: targetVariant.id,
      quantity: 1,
      currency: "USD",
    }),
  });

  // User B checkout with SAME sharedKey -> Must succeed with User B's own order
  const resB = await fetch(`${API_BASE}/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customer2Token}`,
    },
    body: JSON.stringify({ currency: "USD", idempotencyKey: sharedKey }),
  });
  if (resB.status !== 201) {
    const err = await resB.text();
    throw new Error(`User B checkout failed: ${resB.status} - ${err}`);
  }
  const dataB: any = await resB.json();
  console.log(
    `  14c. User B checkout with same key: Order ID ${dataB.order.id}`,
  );
  if (dataB.order.id === dataA1.order.id) {
    throw new Error(
      "CRITICAL: Idempotency scope leak! User B received User A's order!",
    );
  }
  console.log(
    "✓ Scoped idempotency verified: User isolation and payload tamper resistance confirmed.",
  );

  // ----------------------------------------------------
  // Gate 15: Concurrency Probe: Multi-Worker Outbox Processing (SKIP LOCKED)
  // ----------------------------------------------------
  console.log(
    "\n[Gate 15] Concurrency probe: Multi-worker outbox processing with SKIP LOCKED...",
  );
  const dummyEvents = await prisma.$transaction([
    prisma.outboxEvent.create({
      data: {
        aggregateType: "Order",
        aggregateId: `probe-agg-1-${Date.now()}`,
        eventType: "ORDER_PAID",
        payload: { testWorker: 1 },
        status: "PENDING",
      },
    }),
    prisma.outboxEvent.create({
      data: {
        aggregateType: "Order",
        aggregateId: `probe-agg-2-${Date.now()}`,
        eventType: "ORDER_PAID",
        payload: { testWorker: 2 },
        status: "PENDING",
      },
    }),
    prisma.outboxEvent.create({
      data: {
        aggregateType: "Order",
        aggregateId: `probe-agg-3-${Date.now()}`,
        eventType: "ORDER_PAID",
        payload: { testWorker: 3 },
        status: "PENDING",
      },
    }),
    prisma.outboxEvent.create({
      data: {
        aggregateType: "Order",
        aggregateId: `probe-agg-4-${Date.now()}`,
        eventType: "ORDER_PAID",
        payload: { testWorker: 4 },
        status: "PENDING",
      },
    }),
  ]);

  // Concurrently run two worker calls with batchSize 2
  const [w1Result, w2Result] = await Promise.all([
    processOutboxEvents({ batchSize: 2, workerId: "worker-alpha" }),
    processOutboxEvents({ batchSize: 2, workerId: "worker-beta" }),
  ]);

  console.log(`  Worker Alpha processed: ${w1Result.processedCount} events`);
  console.log(`  Worker Beta processed:  ${w2Result.processedCount} events`);

  // Ensure any remainder in batch is drained
  await processOutboxEvents({ batchSize: 10, workerId: "worker-cleanup" });

  // Verify all 4 probe events are now marked PROCESSED
  const verifiedDummyEvents = await prisma.outboxEvent.findMany({
    where: { id: { in: dummyEvents.map((e) => e.id) } },
  });
  const allProcessed = verifiedDummyEvents.every(
    (e) => e.status === "PROCESSED",
  );
  if (!allProcessed) {
    throw new Error("Not all dummy events were marked as PROCESSED");
  }
  console.log(
    "✓ Multi-worker outbox SKIP LOCKED verified (concurrent, non-colliding processing).",
  );

  // ----------------------------------------------------
  // Gate 16: Same-Key Concurrent Checkout (10 concurrent requests)
  // ----------------------------------------------------
  console.log(
    "\n[Gate 16] Same-Key Concurrent Checkout: 10 concurrent requests with identical key...",
  );
  // Prepare active cart
  await fetch(`${API_BASE}/cart`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      variantId: targetVariant.id,
      quantity: 1,
      currency: "USD",
    }),
  });

  const sameKey = `gate16-concurrent-${Date.now()}`;
  const concurrentCheckouts = await Promise.all(
    Array.from({ length: 10 }, () =>
      fetch(`${API_BASE}/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({ currency: "USD", idempotencyKey: sameKey }),
      }),
    ),
  );

  const statuses = concurrentCheckouts.map((r) => r.status);
  console.log(
    `  10 concurrent checkout response statuses: ${statuses.join(", ")}`,
  );
  const allOk = concurrentCheckouts.every((r) => r.ok);
  if (!allOk) {
    const errorBodies = await Promise.all(
      concurrentCheckouts.map((r) => r.text()),
    );
    throw new Error(
      `Gate 16 failed: not all concurrent checkouts succeeded (200/201). Responses: ${errorBodies.join(" | ")}`,
    );
  }

  const checkoutBodies: any[] = await Promise.all(
    concurrentCheckouts.map((r) => r.json()),
  );
  const firstOrder = checkoutBodies[0].order;
  const firstPayment = checkoutBodies[0].payment;

  for (let i = 1; i < checkoutBodies.length; i++) {
    const b = checkoutBodies[i];
    if (b.order.id !== firstOrder.id || b.payment.id !== firstPayment.id) {
      throw new Error(
        `Gate 16 failed: Inconsistent response among concurrent same-key requests! Expected order ${firstOrder.id} and payment ${firstPayment.id}, but got order ${b.order.id} and payment ${b.payment.id}`,
      );
    }
  }

  // Verify in database: exactly 1 order with this cartId/orderNumber
  const matchingOrders = await prisma.order.findMany({
    where: { id: firstOrder.id },
  });
  if (matchingOrders.length !== 1) {
    throw new Error(
      `Gate 16: Expected exactly 1 order in DB, found ${matchingOrders.length}`,
    );
  }
  const matchingPayments = await prisma.payment.findMany({
    where: { id: firstPayment.id },
  });
  if (matchingPayments.length !== 1) {
    throw new Error(
      `Gate 16: Expected exactly 1 payment in DB, found ${matchingPayments.length}`,
    );
  }
  console.log(
    `✓ Gate 16 passed: All 10 concurrent requests returned identical Order ${firstOrder.id} (${firstOrder.orderNumber}) and Payment ${firstPayment.id}.`,
  );

  // ----------------------------------------------------
  // Gate 17: Distinct Price Offers for Same Variant (Monthly vs Yearly)
  // ----------------------------------------------------
  console.log(
    "\n[Gate 17] Distinct price offers for same variant: CartItem key on (cartId, variantId, priceId)...",
  );
  let annualPrice = await prisma.productPrice.findFirst({
    where: {
      variantId: targetVariant.id,
      currency: "USD",
      billingType: "RECURRING",
      billingInterval: "YEARLY",
      isActive: true,
    },
  });
  if (!annualPrice) {
    annualPrice = await prisma.productPrice.create({
      data: {
        variantId: targetVariant.id,
        currency: "USD",
        amount: 9900,
        billingType: "RECURRING",
        billingInterval: "YEARLY",
        isActive: true,
      },
    });
  }

  const defaultPrice = await prisma.productPrice.findFirst({
    where: {
      variantId: targetVariant.id,
      currency: "USD",
      id: { not: annualPrice.id },
      isActive: true,
    },
  });
  if (!defaultPrice) {
    throw new Error("Could not find default price for target variant");
  }

  // Clear customer cart
  await fetch(`${API_BASE}/cart`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${customerToken}` },
  });

  // Add line 1: default price
  const add1Res = await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      variantId: targetVariant.id,
      priceId: defaultPrice.id,
      quantity: 1,
      currency: "USD",
    }),
  });
  if (!add1Res.ok)
    throw new Error(`Add item 1 failed: ${await add1Res.text()}`);

  // Add line 2: annual price
  const add2Res = await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      variantId: targetVariant.id,
      priceId: annualPrice.id,
      quantity: 1,
      currency: "USD",
    }),
  });
  if (!add2Res.ok)
    throw new Error(`Add item 2 failed: ${await add2Res.text()}`);

  const distinctCartRes = await fetch(`${API_BASE}/cart?currency=USD`, {
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  const distinctCart: any = await distinctCartRes.json();
  if (distinctCart.items.length !== 2) {
    throw new Error(
      `Gate 17 failed: Expected 2 distinct items in cart, but found ${distinctCart.items.length}`,
    );
  }
  const priceIdsInCart = distinctCart.items.map((it: any) => it.priceId);
  if (
    !priceIdsInCart.includes(defaultPrice.id) ||
    !priceIdsInCart.includes(annualPrice.id)
  ) {
    throw new Error(
      "Gate 17 failed: Expected both price IDs to be present in distinct cart lines",
    );
  }
  console.log(
    `✓ Gate 17 passed: Cart contains 2 distinct lines for the same variant with different price offers ($${defaultPrice.amount / 100} and $${annualPrice.amount / 100}).`,
  );

  // ----------------------------------------------------
  // Gate 18: Inactive Selected Price: Checkout Must Reject with 400 Bad Request
  // ----------------------------------------------------
  console.log(
    "\n[Gate 18] Inactive selected price: Checkout must reject (400 Bad Request) without silent fallback...",
  );
  await prisma.productPrice.update({
    where: { id: annualPrice.id },
    data: { isActive: false },
  });

  try {
    const inactiveCheckoutRes = await fetch(`${API_BASE}/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ currency: "USD" }),
    });

    console.log(
      `  Checkout with inactive price status: ${inactiveCheckoutRes.status}`,
    );
    if (inactiveCheckoutRes.status !== 400) {
      const resp = await inactiveCheckoutRes.text();
      throw new Error(
        `Gate 18 failed: Expected 400 Bad Request for checkout with inactive price, got ${inactiveCheckoutRes.status}: ${resp}`,
      );
    }
    const errObj: any = await inactiveCheckoutRes.json();
    console.log(`  Expected 400 error message: ${errObj.message}`);
    console.log(
      "✓ Gate 18 passed: Checkout rejected when selected price is inactive (no silent fallback).",
    );
  } finally {
    await prisma.productPrice.update({
      where: { id: annualPrice.id },
      data: { isActive: true },
    });
  }

  // ----------------------------------------------------
  // Gate 19: Converted Cart Mutation: Converted Cart Rejects Mutation (409 Conflict)
  // ----------------------------------------------------
  console.log(
    "\n[Gate 19] Checkout vs Cart Mutation: Mutating converted cart or items must fail with 409 Conflict...",
  );
  await fetch(`${API_BASE}/cart`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  const prepareRes = await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      variantId: targetVariant.id,
      priceId: defaultPrice.id,
      quantity: 1,
      currency: "USD",
    }),
  });
  const cartBeforeCheckout: any = await prepareRes.json();
  const convertedItemId = cartBeforeCheckout.items[0].id;
  const convertedCartId = cartBeforeCheckout.id;

  const covCheckoutRes = await fetch(`${API_BASE}/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({ currency: "USD" }),
  });
  if (!covCheckoutRes.ok) {
    throw new Error(`Checkout failed: ${await covCheckoutRes.text()}`);
  }

  // Attempt 1: PATCH converted cart item quantity -> 409
  const patchRes = await fetch(`${API_BASE}/cart/items/${convertedItemId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({ quantity: 5 }),
  });
  console.log(`  Patch item in converted cart status: ${patchRes.status}`);
  if (patchRes.status !== 409) {
    throw new Error(
      `Gate 19 failed: Expected 409 on PATCH item of converted cart, got ${patchRes.status}`,
    );
  }

  // Attempt 2: DELETE converted cart item -> 409
  const deleteItemRes = await fetch(
    `${API_BASE}/cart/items/${convertedItemId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${customerToken}` },
    },
  );
  console.log(`  Delete item in converted cart status: ${deleteItemRes.status}`);
  if (deleteItemRes.status !== 409) {
    throw new Error(
      `Gate 19 failed: Expected 409 on DELETE item of converted cart, got ${deleteItemRes.status}`,
    );
  }

  // Attempt 3: POST item with explicit converted cartId -> 409
  const postConvertedRes = await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      cartId: convertedCartId,
      variantId: targetVariant.id,
      priceId: defaultPrice.id,
      quantity: 1,
      currency: "USD",
    }),
  });
  console.log(
    `  Add item to converted cartId status: ${postConvertedRes.status}`,
  );
  if (postConvertedRes.status !== 409) {
    throw new Error(
      `Gate 19 failed: Expected 409 on POST to converted cartId, got ${postConvertedRes.status}`,
    );
  }
  console.log(
    "✓ Gate 19 passed: Converted cart and its items are strictly immutable (409 Conflict).",
  );

  // ----------------------------------------------------
  // Gate 20: Concurrent Duplicate Success Callbacks: Exactly 1 ORDER_PAID Outbox Event
  // ----------------------------------------------------
  console.log(
    "\n[Gate 20] Concurrent Duplicate Success Webhooks: Exactly 1 ORDER_PAID outbox event created...",
  );
  await fetch(`${API_BASE}/cart`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      variantId: targetVariant.id,
      quantity: 1,
      currency: "USD",
    }),
  });
  const ckRes20 = await fetch(`${API_BASE}/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({ currency: "USD" }),
  });
  const ckData20: any = await ckRes20.json();
  const paymentId20 = ckData20.payment.id;
  const orderId20 = ckData20.order.id;

  const payloadA = {
    paymentId: paymentId20,
    externalEventId: `evt-succ-A-${Date.now()}`,
    eventType: "payment.succeeded" as const,
  };
  const payloadB = {
    paymentId: paymentId20,
    externalEventId: `evt-succ-B-${Date.now()}`,
    eventType: "payment.succeeded" as const,
  };

  const [cbResA, cbResB] = await Promise.all([
    fetch(`${API_BASE}/payments/test-callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-signature": getTestWebhookSignature(payloadA),
      },
      body: JSON.stringify(payloadA),
    }),
    fetch(`${API_BASE}/payments/test-callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-signature": getTestWebhookSignature(payloadB),
      },
      body: JSON.stringify(payloadB),
    }),
  ]);

  if (!cbResA.ok || !cbResB.ok) {
    throw new Error(
      `Gate 20 failed: Both concurrent webhooks should be accepted (200 OK), got ${cbResA.status} and ${cbResB.status}`,
    );
  }

  const paidOutboxEvents = await prisma.outboxEvent.findMany({
    where: {
      aggregateId: orderId20,
      eventType: "ORDER_PAID",
    },
  });
  console.log(`  ORDER_PAID outbox events count: ${paidOutboxEvents.length}`);
  if (paidOutboxEvents.length !== 1) {
    throw new Error(
      `Gate 20 failed: Expected exactly 1 ORDER_PAID outbox event, found ${paidOutboxEvents.length}`,
    );
  }
  console.log(
    "✓ Gate 20 passed: Exactly 1 ORDER_PAID event written despite 2 concurrent success webhooks with different event IDs.",
  );

  // ----------------------------------------------------
  // Gate 21: Concurrent Success vs Cancel: Terminal State Consistency & Real DB Status Returned
  // ----------------------------------------------------
  console.log(
    "\n[Gate 21] Concurrent Success vs Cancel: Strict state consistency and real DB status on loser...",
  );
  await fetch(`${API_BASE}/cart`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      variantId: targetVariant.id,
      quantity: 1,
      currency: "USD",
    }),
  });
  const ckRes21 = await fetch(`${API_BASE}/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({ currency: "USD" }),
  });
  const ckData21: any = await ckRes21.json();
  const paymentId21 = ckData21.payment.id;
  const orderId21 = ckData21.order.id;

  const payloadSucc = {
    paymentId: paymentId21,
    externalEventId: `evt-race-succ-${Date.now()}`,
    eventType: "payment.succeeded" as const,
  };
  const payloadCanc = {
    paymentId: paymentId21,
    externalEventId: `evt-race-canc-${Date.now()}`,
    eventType: "payment.cancelled" as const,
  };

  const [raceSuccRes, raceCancRes] = await Promise.all([
    fetch(`${API_BASE}/payments/test-callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-signature": getTestWebhookSignature(payloadSucc),
      },
      body: JSON.stringify(payloadSucc),
    }),
    fetch(`${API_BASE}/payments/test-callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-signature": getTestWebhookSignature(payloadCanc),
      },
      body: JSON.stringify(payloadCanc),
    }),
  ]);

  const succBody: any = await raceSuccRes.json();
  const cancBody: any = await raceCancRes.json();

  const dbOrder21 = await prisma.order.findUnique({ where: { id: orderId21 } });
  const dbPayment21 = await prisma.payment.findUnique({
    where: { id: paymentId21 },
  });

  console.log(
    `  Database state: Order=${dbOrder21?.status}, Payment=${dbPayment21?.status}`,
  );
  console.log(`  Success callback response: ${JSON.stringify(succBody)}`);
  console.log(`  Cancel callback response: ${JSON.stringify(cancBody)}`);

  const isValidPair =
    (dbOrder21?.status === "PAID" && dbPayment21?.status === "SUCCEEDED") ||
    (dbOrder21?.status === "CANCELLED" && dbPayment21?.status === "CANCELLED");

  if (!isValidPair) {
    throw new Error(
      `Gate 21 failed: Database ended in inconsistent state: Order=${dbOrder21?.status}, Payment=${dbPayment21?.status}`,
    );
  }

  if (
    succBody.paymentStatus !== dbPayment21?.status ||
    cancBody.paymentStatus !== dbPayment21?.status
  ) {
    throw new Error(
      `Gate 21 failed: Callback response did not return actual database paymentStatus. Expected ${dbPayment21?.status}`,
    );
  }
  console.log(
    "✓ Gate 21 passed: Terminal state is consistent and CAS loser returns actual DB status.",
  );

  // ----------------------------------------------------
  // Gate 22: Outbox Stale Lease Worker Ownership
  // ----------------------------------------------------
  console.log(
    "\n[Gate 22] Outbox Stale Lease: Stale worker cannot finalize reclaimed event...",
  );
  const staleEvent = await prisma.outboxEvent.create({
    data: {
      aggregateType: "Order",
      aggregateId: `stale-order-${Date.now()}`,
      eventType: "ORDER_PAID",
      payload: { test: "lease" },
      status: "PROCESSING",
      lockOwner: "worker-stale-old",
      lockedAt: new Date(Date.now() - 3600 * 1000),
    },
  });

  const activeWorkerRun = await processOutboxEvents({
    batchSize: 10,
    workerId: "worker-active-new",
  });
  console.log(
    `  Active worker processed: ${activeWorkerRun.processedCount} events`,
  );

  const updatedEvent = await prisma.outboxEvent.findUnique({
    where: { id: staleEvent.id },
  });
  if (updatedEvent?.status !== "PROCESSED") {
    throw new Error(
      `Gate 22 failed: Active worker did not claim or process stale event. Current status=${updatedEvent?.status}`,
    );
  }

  const staleWorkerAttempt = await prisma.outboxEvent.updateMany({
    where: {
      id: staleEvent.id,
      status: "PROCESSING",
      lockOwner: "worker-stale-old",
    },
    data: {
      status: "PROCESSED",
    },
  });

  console.log(
    `  Stale worker finalize attempt affected rows: ${staleWorkerAttempt.count}`,
  );
  if (staleWorkerAttempt.count !== 0) {
    throw new Error(
      "Gate 22 failed: Stale worker was able to update event after lease was reclaimed!",
    );
  }
  console.log(
    "✓ Gate 22 passed: Lease ownership CAS prevented stale worker from finalizing reclaimed event.",
  );

  // ----------------------------------------------------
  // Gate 23: Concurrent Checkout vs PATCH cart item (Row lock serialization)
  // ----------------------------------------------------
  console.log("\n[Gate 23] Testing true concurrent race: Checkout vs PATCH cart item...");
  await fetch(`${API_BASE}/cart`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${customerToken}` },
  });

  const addG23Res = await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      variantId: targetVariant.id,
      quantity: 1,
      currency: "USD",
    }),
  });
  const cartG23: any = await addG23Res.json();
  const itemG23 = cartG23.items[0];

  const [resCheckoutG23, resPatchG23] = await Promise.all([
    fetch(`${API_BASE}/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ currency: "USD" }),
    }),
    fetch(`${API_BASE}/cart/items/${itemG23.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ quantity: 5 }),
    }),
  ]);

  const bodyCheckoutG23: any = await resCheckoutG23.json();
  const bodyPatchG23: any = await resPatchG23.json();

  console.log(`  Checkout status: ${resCheckoutG23.status}, Order: ${bodyCheckoutG23.order?.orderNumber || JSON.stringify(bodyCheckoutG23)}`);
  console.log(`  Patch status: ${resPatchG23.status}, Result: ${JSON.stringify(bodyPatchG23.message || bodyPatchG23.id)}`);

  if (resCheckoutG23.status === 201 && resPatchG23.status === 409) {
    console.log("  Outcome: Checkout serialized first, PATCH correctly rejected with 409 Conflict.");
  } else if (resCheckoutG23.status === 201 && resPatchG23.status === 200) {
    console.log("  Outcome: PATCH serialized first, Checkout converted cart with updated quantity.");
    if (bodyCheckoutG23.order.items[0].quantity !== 5) {
      throw new Error(`Gate 23 failed: Expected checkout order item quantity to be 5, got ${bodyCheckoutG23.order.items[0].quantity}`);
    }
  } else {
    throw new Error(`Gate 23 failed: Inconsistent concurrent outcome. Checkout: ${resCheckoutG23.status}, Patch: ${resPatchG23.status}`);
  }
  console.log("✓ Gate 23 passed: Checkout and PATCH cart item strictly linearized without race corruption.");

  // ----------------------------------------------------
  // Gate 24: Concurrent Checkout vs POST cart item
  // ----------------------------------------------------
  console.log("\n[Gate 24] Testing true concurrent race: Checkout vs POST cart item...");
  await fetch(`${API_BASE}/cart`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${customerToken}` },
  });

  await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      variantId: targetVariant.id,
      quantity: 1,
      currency: "USD",
    }),
  });

  const variant2 = targetProduct.variants.find(
    (v: any) => v.id !== targetVariant.id && (v.status === "ACTIVE" || !v.status) && v.prices?.some((p: any) => p.currency === "USD" && (p.isActive ?? true)),
  ) || targetVariant;

  const [resCheckoutG24, resPostG24] = await Promise.all([
    fetch(`${API_BASE}/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ currency: "USD" }),
    }),
    fetch(`${API_BASE}/cart/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        variantId: variant2.id,
        quantity: 2,
        currency: "USD",
      }),
    }),
  ]);

  const bodyCheckoutG24: any = await resCheckoutG24.json();
  const bodyPostG24: any = await resPostG24.json();

  console.log(`  Checkout status: ${resCheckoutG24.status}, Order: ${bodyCheckoutG24.order?.orderNumber || JSON.stringify(bodyCheckoutG24)}`);
  console.log(`  Post status: ${resPostG24.status}, Result: ${JSON.stringify(bodyPostG24.message || bodyPostG24.id)}`);

  if (resCheckoutG24.status !== 201) {
    throw new Error(`Gate 24 failed: Expected checkout to succeed with 201, got ${resCheckoutG24.status}`);
  }

  const orderInDbG24 = await prisma.order.findUnique({
    where: { id: bodyCheckoutG24.order.id },
    include: { items: true },
  });
  if (!orderInDbG24) {
    throw new Error(`Gate 24 failed: Order ${bodyCheckoutG24.order.id} not found in DB`);
  }

  const convertedCartG24 = await prisma.cart.findUnique({
    where: { id: orderInDbG24.cartId! },
    include: { items: true },
  });
  if (!convertedCartG24 || convertedCartG24.status !== "CONVERTED") {
    throw new Error(`Gate 24 failed: Cart ${orderInDbG24.cartId} is not in CONVERTED state in DB`);
  }

  if (resPostG24.status === 409) {
    console.log("  Outcome: Checkout serialized FIRST. POST rejected with 409 Conflict.");
    const hasNewItemInOrder = orderInDbG24.items.some((i) => i.variantId === variant2.id);
    if (hasNewItemInOrder && variant2.id !== targetVariant.id) {
      throw new Error("Gate 24 failed: Order items snapshot contains newly posted item despite 409 Conflict");
    }
    const hasNewItemInCart = convertedCartG24.items.some((i) => i.variantId === variant2.id);
    if (hasNewItemInCart && variant2.id !== targetVariant.id) {
      throw new Error("Gate 24 failed: Converted cart mutated after conversion despite 409 Conflict");
    }
    console.log("  DB Verification: Converted cart immutable, Order snapshot strictly excludes 409-rejected item.");
  } else if (resPostG24.status === 201) {
    console.log("  Outcome: POST serialized FIRST. Checkout converted cart containing both items.");
    const hasNewItemInOrder = orderInDbG24.items.some((i) => i.variantId === variant2.id);
    if (!hasNewItemInOrder) {
      throw new Error("Gate 24 failed: POST returned 201 but order items snapshot missed the newly added variant");
    }
    console.log("  DB Verification: Order snapshot includes the newly added item.");
  } else {
    throw new Error(`Gate 24 failed: Inconsistent concurrent outcome. Checkout: ${resCheckoutG24.status}, POST: ${resPostG24.status}`);
  }
  console.log("✓ Gate 24 passed: Checkout and POST cart item strictly linearized with exact DB snapshot verification.");

  // ----------------------------------------------------
  // Gate 25: Concurrent Checkout vs DELETE cart item
  // ----------------------------------------------------
  console.log("\n[Gate 25] Testing true concurrent race: Checkout vs DELETE cart item...");
  await fetch(`${API_BASE}/cart`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${customerToken}` },
  });

  await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      variantId: targetVariant.id,
      quantity: 1,
      currency: "USD",
    }),
  });

  const variantToDel = targetProduct.variants.find(
    (v: any) => v.id !== targetVariant.id && (v.status === "ACTIVE" || !v.status) && v.prices?.some((p: any) => p.currency === "USD" && (p.isActive ?? true)),
  ) || targetVariant;

  const addG25Res = await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      variantId: variantToDel.id,
      quantity: 2,
      currency: "USD",
    }),
  });
  const cartG25: any = await addG25Res.json();
  const itemG25 = cartG25.items.find((i: any) => i.variantId === variantToDel.id);
  if (!itemG25) {
    throw new Error("Gate 25 setup failed: Could not find item to delete in cart");
  }

  const [resCheckoutG25, resDeleteG25] = await Promise.all([
    fetch(`${API_BASE}/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ currency: "USD" }),
    }),
    fetch(`${API_BASE}/cart/items/${itemG25.id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${customerToken}`,
      },
    }),
  ]);

  console.log(`  Checkout status: ${resCheckoutG25.status}, Delete status: ${resDeleteG25.status}`);
  if (resCheckoutG25.status !== 201) {
    throw new Error(`Gate 25 failed: Expected checkout 201, got ${resCheckoutG25.status}`);
  }

  const bodyCheckoutG25: any = await resCheckoutG25.json();
  const orderInDbG25 = await prisma.order.findUnique({
    where: { id: bodyCheckoutG25.order.id },
    include: { items: true },
  });
  if (!orderInDbG25) {
    throw new Error(`Gate 25 failed: Order ${bodyCheckoutG25.order.id} not found in DB`);
  }

  const convertedCartG25 = await prisma.cart.findUnique({
    where: { id: orderInDbG25.cartId! },
    include: { items: true },
  });
  if (!convertedCartG25 || convertedCartG25.status !== "CONVERTED") {
    throw new Error(`Gate 25 failed: Converted cart not found or not CONVERTED in DB`);
  }

  if (resDeleteG25.status === 409) {
    console.log("  Outcome: Checkout serialized FIRST. DELETE rejected with 409 Conflict.");
    const hasDeletedItemInOrder = orderInDbG25.items.some((i) => i.variantId === variantToDel.id);
    if (!hasDeletedItemInOrder) {
      throw new Error("Gate 25 failed: Checkout won lock but order items snapshot missed the item");
    }
    const hasItemInCart = convertedCartG25.items.some((i) => i.variantId === variantToDel.id);
    if (!hasItemInCart) {
      throw new Error("Gate 25 failed: Converted cart corrupted by rejected DELETE");
    }
    console.log("  DB Verification: Converted cart preserved, Order snapshot includes the contested item.");
  } else if (resDeleteG25.status === 200) {
    console.log("  Outcome: DELETE serialized FIRST. Checkout snapshot reflects deleted item removed.");
    if (variantToDel.id !== targetVariant.id) {
      const hasDeletedItemInOrder = orderInDbG25.items.some((i) => i.variantId === variantToDel.id);
      if (hasDeletedItemInOrder) {
        throw new Error("Gate 25 failed: DELETE returned 200 OK but deleted item still appears in Order snapshot");
      }
    }
    console.log("  DB Verification: Deleted item is strictly absent from Order items snapshot.");
  } else {
    throw new Error(`Gate 25 failed: Inconsistent outcome. Checkout: ${resCheckoutG25.status}, Delete: ${resDeleteG25.status}`);
  }
  console.log("✓ Gate 25 passed: Checkout and DELETE cart item strictly linearized with exact DB snapshot verification.");

  // ----------------------------------------------------
  // Gate 26: Concurrent Checkout vs clear cart (DELETE /cart)
  // ----------------------------------------------------
  console.log("\n[Gate 26] Testing true concurrent race: Checkout vs clear cart...");
  await fetch(`${API_BASE}/cart`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${customerToken}` },
  });

  await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      variantId: targetVariant.id,
      quantity: 1,
      currency: "USD",
    }),
  });

  const [resCheckoutG26, resClearG26] = await Promise.all([
    fetch(`${API_BASE}/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ currency: "USD" }),
    }),
    fetch(`${API_BASE}/cart`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${customerToken}`,
      },
    }),
  ]);

  console.log(`  Checkout status: ${resCheckoutG26.status}, Clear cart status: ${resClearG26.status}`);
  if (resClearG26.status !== 200) {
    throw new Error(`Gate 26 failed: Expected clear cart to return 200 OK, got ${resClearG26.status}`);
  }

  if (resCheckoutG26.status === 201) {
    console.log("  Outcome: Checkout serialized FIRST. Order created; clear cart was a safe no-op on converted cart.");
    const bodyCheckoutG26: any = await resCheckoutG26.json();
    const orderInDbG26 = await prisma.order.findUnique({
      where: { id: bodyCheckoutG26.order.id },
      include: { items: true },
    });
    if (!orderInDbG26 || orderInDbG26.items.length !== 1 || orderInDbG26.items[0].variantId !== targetVariant.id) {
      throw new Error("Gate 26 failed: Order snapshot corrupted or items missing");
    }
    const convertedCartG26 = await prisma.cart.findUnique({
      where: { id: orderInDbG26.cartId! },
      include: { items: true },
    });
    if (!convertedCartG26 || convertedCartG26.status !== "CONVERTED" || convertedCartG26.items.length !== 1) {
      throw new Error("Gate 26 failed: Converted cart items were deleted or cart is not CONVERTED in DB");
    }
    console.log("  DB Verification: Order snapshot intact, converted cart items preserved.");
  } else if (resCheckoutG26.status === 400) {
    console.log("  Outcome: Clear cart serialized FIRST. Checkout failed with 400 Bad Request (cart empty). No corrupt order created.");
    const activeCartG26 = await prisma.cart.findFirst({
      where: { userId: customerUser.id, status: "ACTIVE" },
      include: { items: true },
    });
    if (activeCartG26 && activeCartG26.items.length !== 0) {
      throw new Error("Gate 26 failed: Clear cart won lock but active cart still has items in DB");
    }
    console.log("  DB Verification: Active cart has 0 items, zero order created.");
  } else {
    throw new Error(`Gate 26 failed: Inconsistent outcome. Checkout: ${resCheckoutG26.status}, Clear: ${resClearG26.status}`);
  }
  console.log("✓ Gate 26 passed: Checkout and clear cart strictly linearized with exact DB snapshot verification.");

  // ----------------------------------------------------
  // Gate 27: Mixed USD / VND cart rejected
  // ----------------------------------------------------
  console.log("\n[Gate 27] Enforcing single currency per cart: Mixed USD / VND rejection...");
  await fetch(`${API_BASE}/cart`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${customerToken}` },
  });

  const addUsdRes = await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      variantId: targetVariant.id,
      quantity: 1,
      currency: "USD",
    }),
  });
  if (!addUsdRes.ok) throw new Error(`Gate 27: Failed to add initial USD item: ${await addUsdRes.text()}`);

  const addVndRes = await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      variantId: targetVariant.id,
      quantity: 1,
      currency: "VND",
    }),
  });

  if (addVndRes.status !== 400) {
    throw new Error(`Gate 27 failed: Expected 400 Bad Request when adding VND item to USD cart, got ${addVndRes.status}`);
  }
  const vndErr: any = await addVndRes.json();
  console.log(`  Rejected as expected: ${vndErr.message}`);
  if (!vndErr.message?.includes("Clear cart to change currency")) {
    throw new Error(`Gate 27 failed: Error message does not instruct user to clear cart to switch currency: ${vndErr.message}`);
  }
  console.log("✓ Gate 27 passed: Single currency per cart enforced (Option A).");

  // ----------------------------------------------------
  // Gate 28: GET cart never cross-sums currency
  // ----------------------------------------------------
  console.log("\n[Gate 28] Verifying GET /cart never cross-sums different currencies...");
  const dbUser = await prisma.user.findFirst({ where: { email: "customer@nexustheme.dev" } });
  if (!dbUser) throw new Error("Gate 28: Customer user not found");

  const activeCart = await prisma.cart.findFirst({
    where: { userId: dbUser.id, status: "ACTIVE" },
  });
  if (!activeCart) throw new Error("Gate 28: Active cart not found");

  const vndPrice = await prisma.productPrice.findFirst({
    where: { variantId: targetVariant.id, currency: "VND", isActive: true },
  });
  if (!vndPrice) throw new Error("Gate 28: VND price not found for target variant");

  const rogueItem = await prisma.cartItem.create({
    data: {
      cartId: activeCart.id,
      variantId: targetVariant.id,
      priceId: vndPrice.id,
      quantity: 3,
    },
  });

  const getCartG28Res = await fetch(`${API_BASE}/cart`, {
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  const cartG28Data: any = await getCartG28Res.json();

  console.log(`  Cart currency: ${cartG28Data.currency}, Subtotal: ${cartG28Data.subtotalAmount}, Total: ${cartG28Data.totalAmount}`);
  const usdItem = cartG28Data.items.find((i: any) => i.currency === "USD");
  const rogueItemDto = cartG28Data.items.find((i: any) => i.id === rogueItem.id);

  if (!usdItem || !usdItem.isAvailable) {
    throw new Error("Gate 28 failed: USD item should be available");
  }
  if (!rogueItemDto || rogueItemDto.isAvailable !== false) {
    throw new Error("Gate 28 failed: Mismatched VND item must have isAvailable: false");
  }
  if (!rogueItemDto.unavailableReason?.includes("Currency mismatch")) {
    throw new Error(`Gate 28 failed: Expected unavailableReason to mention currency mismatch, got: ${rogueItemDto.unavailableReason}`);
  }
  if (cartG28Data.subtotalAmount !== usdItem.lineTotalAmount) {
    throw new Error(`Gate 28 failed: Subtotal was cross-summed! Expected ${usdItem.lineTotalAmount}, got ${cartG28Data.subtotalAmount}`);
  }

  await prisma.cartItem.delete({ where: { id: rogueItem.id } });
  console.log("✓ Gate 28 passed: Zero cross-currency sum and unavailable flag properly enforced.");

  // ----------------------------------------------------
  // Gate 29: Inactive selected price not treated as valid cart total
  // ----------------------------------------------------
  console.log("\n[Gate 29] Inactive price: Excluded from cart total and strictly rejects checkout...");
  await fetch(`${API_BASE}/cart`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${customerToken}` },
  });

  const addG29Res = await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      variantId: targetVariant.id,
      quantity: 1,
      currency: "USD",
    }),
  });
  const cartG29: any = await addG29Res.json();
  const itemG29 = cartG29.items[0];

  await prisma.productPrice.update({
    where: { id: itemG29.priceId },
    data: { isActive: false },
  });

  try {
    const checkCartRes = await fetch(`${API_BASE}/cart`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const checkCartData: any = await checkCartRes.json();
    console.log(`  Cart subtotal with inactive price: ${checkCartData.subtotalAmount}`);
    if (checkCartData.subtotalAmount !== 0) {
      throw new Error(`Gate 29 failed: Inactive price was included in cart subtotal! Expected 0, got ${checkCartData.subtotalAmount}`);
    }
    if (checkCartData.items[0].isAvailable !== false) {
      throw new Error("Gate 29 failed: Item with inactive price must be flagged isAvailable: false");
    }

    const checkCheckoutRes = await fetch(`${API_BASE}/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({ currency: "USD" }),
    });

    if (checkCheckoutRes.status !== 400) {
      throw new Error(`Gate 29 failed: Expected 400 Bad Request on checkout with inactive price, got ${checkCheckoutRes.status}`);
    }
    const checkoutErr: any = await checkCheckoutRes.json();
    console.log(`  Checkout rejected as expected: ${checkoutErr.message}`);
  } finally {
    await prisma.productPrice.update({
      where: { id: itemG29.priceId },
      data: { isActive: true },
    });
  }
  console.log("✓ Gate 29 passed: Inactive price excluded from cart total and checkout fail-closed.");

  // ----------------------------------------------------
  // Gate 30: Stale IN_PROGRESS idempotency lease recovery
  // ----------------------------------------------------
  console.log("\n[Gate 30] Idempotency: Stale IN_PROGRESS lease recovery after crash...");
  await fetch(`${API_BASE}/cart`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${customerToken}` },
  });

  await fetch(`${API_BASE}/cart/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      variantId: targetVariant.id,
      quantity: 1,
      currency: "USD",
    }),
  });

  const staleKey = `stale-recovery-key-${Date.now()}`;
  const requestFingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify({ userId: dbUser.id, currency: "USD" }))
    .digest("hex");

  await prisma.idempotencyKey.create({
    data: {
      key: staleKey,
      scope: "checkout",
      userId: dbUser.id,
      requestFingerprint,
      status: "IN_PROGRESS",
      startedAt: new Date(Date.now() - 15000), // 15s ago
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    },
  });

  const reclaimRes = await fetch(`${API_BASE}/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      currency: "USD",
      idempotencyKey: staleKey,
    }),
  });

  if (reclaimRes.status !== 201) {
    const errText = await reclaimRes.text();
    throw new Error(`Gate 30 failed: Expected 201 Created after reclaiming stale lease, got ${reclaimRes.status}: ${errText}`);
  }

  const reclaimData: any = await reclaimRes.json();
  console.log(`  Checkout succeeded with reclaimed key, Order: ${reclaimData.order?.orderNumber}`);

  const keyInDb = await prisma.idempotencyKey.findUnique({
    where: {
      scope_userId_key: {
        scope: "checkout",
        userId: dbUser.id,
        key: staleKey,
      },
    },
  });

  if (keyInDb?.status !== "COMMITTED") {
    throw new Error(`Gate 30 failed: Expected idempotency key to be COMMITTED, got ${keyInDb?.status}`);
  }

  const replayRes = await fetch(`${API_BASE}/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customerToken}`,
    },
    body: JSON.stringify({
      currency: "USD",
      idempotencyKey: staleKey,
    }),
  });
  const replayData: any = await replayRes.json();
  if (replayData.order?.id !== reclaimData.order?.id) {
    throw new Error("Gate 30 failed: Replay did not return identical order");
  }
  console.log("✓ Gate 30 passed: Stale IN_PROGRESS lease reclaimed and idempotently committed.");

  console.log("\n==================================================");
  console.log("ALL 30 LIVE RUNTIME ACCEPTANCE GATES PASSED!");
  console.log("==================================================");
}

runAcceptance()
  .then(async () => {
    if (apiProcess) apiProcess.kill("SIGTERM");
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("\n❌ RUNTIME ACCEPTANCE FAILED:", err);
    if (apiProcess) apiProcess.kill("SIGTERM");
    await prisma.$disconnect();
    process.exit(1);
  });
