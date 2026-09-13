import { prisma } from "../src/client";
import { processOutboxEvents } from "../../../apps/worker/src/outbox-processor";

const API_BASE = process.env.API_URL || "http://localhost:4000";

async function runAcceptance() {
  console.log("==================================================");
  console.log("PHASE 4 — COMMERCE CORE LIVE RUNTIME ACCEPTANCE");
  console.log("==================================================\n");

  const customerToken = "dev-customer-token";
  const customer2Token = "dev-no-email:sub_dev_customer_002";
  const adminToken = "dev-admin-token";

  // ----------------------------------------------------
  // Gate 1: Health 200
  // ----------------------------------------------------
  console.log("[Gate 1] Checking API Health...");
  const healthRes = await fetch(`${API_BASE}/health`);
  if (!healthRes.ok) throw new Error(`Health check failed: ${healthRes.status}`);
  const healthData: any = await healthRes.json();
  console.log("✓ Health status 200 OK:", JSON.stringify(healthData));
  if (healthData.status !== "ok") throw new Error("Health status is not ok");

  // ----------------------------------------------------
  // Gate 2: Public Catalog & Variant Lookup
  // ----------------------------------------------------
  console.log("\n[Gate 2] Querying active catalog products...");
  const productsRes = await fetch(`${API_BASE}/products?currency=USD`);
  if (!productsRes.ok) throw new Error(`Fetch products failed: ${productsRes.status}`);
  const productsData: any = await productsRes.json();
  const products = productsData.items || [];
  if (products.length === 0) throw new Error("No products found in catalog");

  const productSummary = products[0];
  const detailRes = await fetch(`${API_BASE}/products/${productSummary.slug}?currency=USD`);
  if (!detailRes.ok) throw new Error(`Fetch product detail failed: ${detailRes.status}`);
  const targetProduct: any = await detailRes.json();
  if (!targetProduct.variants || targetProduct.variants.length === 0) {
    throw new Error("Target product has no variants");
  }
  const targetVariant = targetProduct.variants[0];
  const targetPrice = targetVariant.prices?.find((p: any) => p.currency === "USD")?.amount;
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
  console.log(`✓ Item added. Cart ID: ${cartData.id}, Items Count: ${cartData.itemCount}`);
  if (cartData.itemCount !== 2) throw new Error(`Expected 2 items, got ${cartData.itemCount}`);

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
  console.log("✓ Backend authoritative repricing verified (client prices ignored).");

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
  console.log(`  Payment ID:     ${payment.id} (Status: ${payment.status}, Amount: ${payment.amount})`);

  if (order.status !== "PENDING_PAYMENT") {
    throw new Error(`Expected order status PENDING_PAYMENT, got ${order.status}`);
  }
  if (payment.status !== "PENDING") {
    throw new Error(`Expected payment status PENDING, got ${payment.status}`);
  }
  if (order.totalAmount !== expectedTotalAmount) {
    throw new Error(`Expected order total ${expectedTotalAmount}, got ${order.totalAmount}`);
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
  // Gate 7: Cross-User Order Access Denied (Ownership Enforcement)
  // ----------------------------------------------------
  console.log("\n[Gate 7] Verifying cross-user access rejection (Customer A vs Customer B)...");
  const crossUserRes = await fetch(`${API_BASE}/orders/${order.id}`, {
    headers: { Authorization: `Bearer ${customer2Token}` },
  });

  console.log(`  Customer B fetch Customer A order status: ${crossUserRes.status}`);
  if (crossUserRes.status !== 403 && crossUserRes.status !== 404) {
    throw new Error(`Expected 403 Forbidden for cross-user access, got ${crossUserRes.status}`);
  }
  console.log("✓ Cross-user access strictly denied (403 Forbidden).");

  // Admin access check (order.read)
  const adminRes = await fetch(`${API_BASE}/admin/orders/${order.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!adminRes.ok) throw new Error(`Admin fetch failed: ${adminRes.status}`);
  console.log("✓ Admin with order.read permission can view order details.");

  // ----------------------------------------------------
  // Gate 8: Test Payment Succeeded State Machine Transition (Payment -> SUCCEEDED, Order -> PAID)
  // ----------------------------------------------------
  console.log("\n[Gate 8] Executing test payment success transition...");
  const externalEventId = `evt_live_test_${Date.now()}`;
  const callbackRes = await fetch(`${API_BASE}/payments/test-callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paymentId: payment.id,
      externalEventId,
      eventType: "payment.succeeded",
      metadata: { simulatedBy: "live-runtime-acceptance" },
    }),
  });

  if (!callbackRes.ok) {
    const err = await callbackRes.text();
    throw new Error(`Test callback failed: ${err}`);
  }

  const callbackData: any = await callbackRes.json();
  console.log("  Callback Response:", JSON.stringify(callbackData));

  if (callbackData.paymentStatus !== "SUCCEEDED" || callbackData.orderStatus !== "PAID") {
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
    throw new Error(`Expected reloaded order status PAID, got ${reloadedOrder.status}`);
  }

  // ----------------------------------------------------
  // Gate 9: Idempotency (Duplicate Event Check)
  // ----------------------------------------------------
  console.log("\n[Gate 9] Sending duplicate payment event to test idempotency...");
  const duplicateCallbackRes = await fetch(`${API_BASE}/payments/test-callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paymentId: payment.id,
      externalEventId, // Identical event ID
      eventType: "payment.succeeded",
    }),
  });

  const duplicateData: any = await duplicateCallbackRes.json();
  console.log("  Duplicate Response:", JSON.stringify(duplicateData));
  if (!duplicateData.duplicate) {
    throw new Error("Expected duplicate=true for resending identical event");
  }
  console.log("✓ Idempotency verified: duplicate event detected and handled without re-mutation.");

  // ----------------------------------------------------
  // Gate 10: Transactional Outbox (ORDER_PAID Atomicity)
  // ----------------------------------------------------
  console.log("\n[Gate 10] Verifying Transactional Outbox in PostgreSQL database...");
  const outboxEvents = await prisma.outboxEvent.findMany({
    where: {
      aggregateId: order.id,
      eventType: "ORDER_PAID",
    },
  });

  console.log(`  Outbox events for Order ${order.id}: count = ${outboxEvents.length}`);
  if (outboxEvents.length !== 1) {
    throw new Error(`Expected exactly 1 ORDER_PAID outbox event, found ${outboxEvents.length}`);
  }

  const outboxEvent = outboxEvents[0];
  console.log(`  Outbox Event ID:   ${outboxEvent.id}`);
  console.log(`  Event Type:        ${outboxEvent.eventType}`);
  console.log(`  Initial Status:    ${outboxEvent.status}`);
  console.log(`  Payload:           `, JSON.stringify(outboxEvent.payload));

  if (outboxEvent.status !== "PENDING") {
    throw new Error(`Expected outbox event status PENDING, got ${outboxEvent.status}`);
  }
  console.log("✓ Transactional Outbox event exactly-once atomicity verified.");

  // ----------------------------------------------------
  // Gate 11: Worker Outbox Processor
  // ----------------------------------------------------
  console.log("\n[Gate 11] Running Worker Outbox Processor...");
  const workerResult = await processOutboxEvents();
  console.log(`✓ Worker processed ${workerResult.processedCount} outbox events.`);

  const processedEvent = await prisma.outboxEvent.findUnique({
    where: { id: outboxEvent.id },
  });
  console.log(`  Updated Outbox Status: ${processedEvent?.status}`);
  console.log(`  Processed At:          ${processedEvent?.processedAt?.toISOString()}`);

  if (processedEvent?.status !== "PROCESSED") {
    throw new Error(`Expected outbox status PROCESSED, got ${processedEvent?.status}`);
  }
  console.log("✓ Worker outbox processing verified (strictly foundational, no entitlement).");

  console.log("\n==================================================");
  console.log("ALL 11 LIVE RUNTIME ACCEPTANCE GATES PASSED!");
  console.log("==================================================");
}

runAcceptance()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("\n❌ RUNTIME ACCEPTANCE FAILED:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
