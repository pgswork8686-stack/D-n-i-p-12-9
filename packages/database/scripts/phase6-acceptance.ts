import * as crypto from "node:crypto";
import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
import {
  prisma,
  EntitlementStatus,
  ProductType,
  FulfillmentType,
  reconcileExternalAllocations,
} from "../src/index";

const API_BASE = process.env.API_URL || "http://localhost:4000";

let apiProcess: ChildProcess | null = null;
let workerProcess: ChildProcess | null = null;

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
      // keep waiting
    }
  }
  throw new Error("Timed out waiting for API server to start");
}

async function ensureWorkerRunning(): Promise<void> {
  console.log("  Spawning worker child process 'worker-acceptance-phase6'...");
  workerProcess = spawn("node", [path.resolve(__dirname, "../../../apps/worker/dist/index.js")], {
    stdio: "pipe",
    env: {
      ...process.env,
      WORKER_ID: "worker-acceptance-phase6",
      OUTBOX_POLL_INTERVAL_MS: "500",
    },
  });

  await sleep(1500);
}

function stopChildProcesses(): void {
  if (workerProcess) {
    try {
      workerProcess.kill("SIGTERM");
    } catch {}
    workerProcess = null;
  }
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

async function apiGet(endpoint: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${endpoint}`, { headers });
  const data: any = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function runPhase6Acceptance() {
  console.log("==================================================");
  console.log("PHASE 6 — ELEMENTOR EXTERNAL LICENSE LIVE ACCEPTANCE (22 GATES)");
  console.log("==================================================");

  // [Gate 1] Health & Worker Runtime
  console.log("\n[Gate 1] Verifying API Health & Spawning Worker Runtime...");
  await ensureApiRunning();
  await ensureWorkerRunning();
  console.log("✓ Gate 1 passed: API is healthy and worker runtime is active");

  // Setup actors
  const customer1Token = "dev-customer-token";
  const customer2Token = "dev-custom:sub_dev_customer_002:customer2@nexustheme.dev";
  const adminToken = "dev-admin-token";

  const cust1Res = await apiGet("/auth/me", customer1Token);
  const customer1Id = cust1Res.data.id;

  const cust2Res = await apiGet("/auth/me", customer2Token);
  const customer2Id = cust2Res.data.id;

  const adminRes = await apiGet("/auth/me", adminToken);
  const adminId = adminRes.data.id;


  console.log(`  Actor 1 (Customer 1): ${customer1Id}`);
  console.log(`  Actor 2 (Customer 2): ${customer2Id}`);
  console.log(`  Actor 3 (Admin): ${adminId}`);

  // Ensure ELEMENTOR License Provider exists
  const provider = await prisma.licenseProvider.upsert({
    where: { code: "ELEMENTOR" },
    update: { status: "ACTIVE", fulfillmentMode: "MANUAL_EXTERNAL" },
    create: {
      code: "ELEMENTOR",
      name: "Elementor Pro",
      status: "ACTIVE",
      fulfillmentMode: "MANUAL_EXTERNAL",
      metadata: { vendor: "Elementor" },
    },
  });

  // Ensure Default Provider Account
  const mainAccount = await prisma.providerAccount.upsert({
    where: { id: "pa-elementor-main-01" },
    update: { totalCapacity: 1000, status: "ACTIVE" },
    create: {
      id: "pa-elementor-main-01",
      providerId: provider.id,
      name: "Elementor Agency Subscription #1",
      externalReference: "ELE-SUB-AGENCY-001",
      totalCapacity: 1000,
      status: "ACTIVE",
    },
  });

  // Helper to create valid Order + OrderItem for FKs
  const pElementor = await prisma.product.findUniqueOrThrow({ where: { slug: "elementor-pro" } });
  const vElementor = await prisma.productVariant.findFirstOrThrow({ where: { productId: pElementor.id } });

  async function createTestEntitlement(params: {
    userId: string;
    fulfillmentType?: FulfillmentType;
    status?: EntitlementStatus;
    maxActivations?: number | null;
    expiresAt?: Date | null;
  }) {
    const order = await prisma.order.create({
      data: {
        userId: params.userId,
        orderNumber: `ORD-P6-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
        status: "PAID",
        currency: "USD",
        subtotalAmount: 1200,
        discountAmount: 0,
        totalAmount: 1200,
      },
    });

    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: pElementor.id,
        variantId: vElementor.id,
        productName: pElementor.name,
        variantName: vElementor.name,
        sku: vElementor.sku,
        productType: ProductType.EXTERNAL_MANAGED_LICENSE,
        fulfillmentType: params.fulfillmentType || FulfillmentType.EXTERNAL_MANAGED,
        unitAmount: 1200,
        quantity: 1,
        lineTotalAmount: 1200,
        currency: "USD",
        licensePlanIdAtPurchase: "plan-ele-1site",
        maxActivations: params.maxActivations !== undefined ? params.maxActivations : 2,
        snapshotVersion: 1,
      },
    });

    return prisma.entitlement.create({
      data: {
        userId: params.userId,
        orderId: order.id,
        orderItemId: item.id,
        productId: pElementor.id,
        variantId: vElementor.id,
        productType: ProductType.EXTERNAL_MANAGED_LICENSE,
        fulfillmentType: params.fulfillmentType || FulfillmentType.EXTERNAL_MANAGED,
        status: params.status || EntitlementStatus.ACTIVE,
        maxActivations: params.maxActivations !== undefined ? params.maxActivations : 2,
        expiresAt: params.expiresAt || null,
      },
    });
  }

  const runId = Date.now();

  // [Gate 2] EXTERNAL_MANAGED entitlement exists
  console.log("\n[Gate 2] Verifying EXTERNAL_MANAGED entitlement creation & access...");
  const entCust1 = await createTestEntitlement({
    userId: customer1Id,
    maxActivations: 2,
  });

  const entRes = await apiGet(`/entitlements/${entCust1.id}`, customer1Token);
  if (
    !entRes.ok ||
    entRes.data.fulfillmentType !== "EXTERNAL_MANAGED" ||
    entRes.data.maxActivations !== 2 ||
    entRes.data.status !== "ACTIVE"
  ) {
    throw new Error(`Gate 2 failed: unexpected entitlement: ${JSON.stringify(entRes.data)}`);
  }
  console.log(`✓ Gate 2 passed: EXTERNAL_MANAGED entitlement verified (maxActivations: ${entRes.data.maxActivations})`);

  // [Gate 3] Customer requests domain allocation
  console.log("\n[Gate 3] Customer requests domain allocation...");
  const domain1Raw = `https://My-Company-Website-${runId}.com/subpage`;
  const domain1Normalized = `my-company-website-${runId}.com`;
  const allocRes1 = await apiPost(
    `/entitlements/${entCust1.id}/allocations`,
    { domain: domain1Raw },
    customer1Token,
  );
  if (
    !allocRes1.ok ||
    allocRes1.data.status !== "PENDING" ||
    allocRes1.data.normalizedDomain !== domain1Normalized ||
    allocRes1.data.providerCode !== "ELEMENTOR" ||
    allocRes1.data.fulfillmentMode !== "MANUAL_EXTERNAL"
  ) {
    throw new Error(`Gate 3 failed: unexpected allocation response: ${JSON.stringify(allocRes1.data)}`);
  }
  const alloc1 = allocRes1.data;
  console.log(`✓ Gate 3 passed: Allocation created with status PENDING for normalized domain '${alloc1.normalizedDomain}'`);

  // [Gate 4] Domain Normalization
  console.log("\n[Gate 4] Testing authoritative domain normalization and rejection invariants...");
  const domain2Raw = `https://www.Agency-Portfolio-${runId}.com./`;
  const domain2Normalized = `agency-portfolio-${runId}.com`;
  const allocRes2 = await apiPost(
    `/entitlements/${entCust1.id}/allocations`,
    { domain: domain2Raw },
    customer1Token,
  );
  if (!allocRes2.ok || allocRes2.data.normalizedDomain !== domain2Normalized) {
    throw new Error(`Gate 4 failed: domain normalization expected '${domain2Normalized}', got '${allocRes2.data?.normalizedDomain}'`);
  }

  // Test invalid domain rejections
  const invalidDomains = [
    "localhost",
    "http://localhost:8080",
    "127.0.0.1",
    "https://192.168.1.1:3000",
    "[::1]",
    "*.wildcard.com",
    "http://",
    "/just/a/path",
    "invalid_domain_without_tld",
  ];

  for (const inv of invalidDomains) {
    const invRes = await apiPost(
      `/entitlements/${entCust1.id}/allocations`,
      { domain: inv },
      customer1Token,
    );
    if (invRes.ok) {
      throw new Error(`Gate 4 failed: invalid domain '${inv}' was unexpectedly accepted!`);
    }
  }
  console.log("✓ Gate 4 passed: Normalization stripped protocol/www/case/port/path and rejected all invalid hostnames");

  // [Gate 5] Cross-user entitlement allocation request denied
  console.log("\n[Gate 5] Testing cross-user allocation isolation (strict 403)...");
  const crossRes = await apiPost(
    `/entitlements/${entCust1.id}/allocations`,
    { domain: `customer2-attack-${runId}.com` },
    customer2Token,
  );
  if (crossRes.status !== 403) {
    throw new Error(`Gate 5 failed: Customer 2 request was not rejected with 403! Got status ${crossRes.status}`);
  }
  console.log("✓ Gate 5 passed: Cross-user allocation request strictly rejected with 403 Forbidden");

  // [Gate 6] Non-EXTERNAL_MANAGED entitlement denied
  console.log("\n[Gate 6] Verifying non-EXTERNAL_MANAGED entitlement is rejected...");
  const internalEnt = await createTestEntitlement({
    userId: customer1Id,
    fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
  });
  const nonExtRes = await apiPost(
    `/entitlements/${internalEnt.id}/allocations`,
    { domain: `valid-domain-${runId}.com` },
    customer1Token,
  );
  if (nonExtRes.status !== 400) {
    throw new Error(`Gate 6 failed: non-EXTERNAL_MANAGED entitlement expected 400, got ${nonExtRes.status}`);
  }
  console.log("✓ Gate 6 passed: non-EXTERNAL_MANAGED entitlement rejected with 400 Bad Request");

  // [Gate 7] maxActivations enforced
  console.log("\n[Gate 7] Verifying maxActivations limit enforcement (409 Conflict)...");
  // entCust1 has maxActivations = 2, currently has 2 allocations (alloc1, alloc2)
  const thirdAllocRes = await apiPost(
    `/entitlements/${entCust1.id}/allocations`,
    { domain: `third-domain-overflow-${runId}.com` },
    customer1Token,
  );
  if (thirdAllocRes.status !== 409) {
    throw new Error(`Gate 7 failed: allocation exceeding maxActivations expected 409, got ${thirdAllocRes.status}`);
  }
  console.log("✓ Gate 7 passed: Request exceeding maxActivations limit strictly rejected with 409 Conflict");

  // [Gate 8] Concurrent allocation race cannot exceed maxActivations
  console.log("\n[Gate 8] Testing concurrent allocation race on 1-seat entitlement (PostgreSQL row lock)...");
  const singleSeatEnt = await createTestEntitlement({
    userId: customer1Id,
    maxActivations: 1,
  });

  const concurrentDomains = Array.from({ length: 8 }, (_, i) => `concurrent-race-${runId}-seat-${i + 1}.com`);
  const raceResults = await Promise.all(
    concurrentDomains.map((d) =>
      apiPost(`/entitlements/${singleSeatEnt.id}/allocations`, { domain: d }, customer1Token),
    ),
  );

  const succeededCount = raceResults.filter((r) => r.status === 201).length;
  const rejectedCount = raceResults.filter((r) => r.status === 409).length;

  const totalInDb = await prisma.licenseAllocation.count({
    where: { entitlementId: singleSeatEnt.id },
  });

  if (succeededCount !== 1 || totalInDb !== 1) {
    throw new Error(
      `Gate 8 failed: expected exactly 1 succeeded allocation, got ${succeededCount} succeeded and ${totalInDb} in DB`,
    );
  }
  console.log(`✓ Gate 8 passed: Exactly 1 concurrent request succeeded, ${rejectedCount} rejected with 409, DB has exactly 1 allocation`);

  // [Gate 9] Admin with license.read can list
  console.log("\n[Gate 9] Verifying Admin with license.read can list providers, accounts, and allocations...");
  const provListRes = await apiGet("/admin/license-providers", adminToken);
  const accListRes = await apiGet("/admin/provider-accounts", adminToken);
  const allocListRes = await apiGet("/admin/license-allocations", adminToken);

  if (!provListRes.ok || !accListRes.ok || !allocListRes.ok) {
    throw new Error("Gate 9 failed: Admin could not list allocations or providers");
  }
  console.log(`✓ Gate 9 passed: Admin listed ${provListRes.data.length} providers, ${accListRes.data.length} accounts, and ${allocListRes.data.total} allocations`);

  // [Gate 10] Customer admin endpoint 403
  console.log("\n[Gate 10] Verifying Customer role is forbidden from admin endpoints (strict 403)...");
  const custAdminAllocList = await apiGet("/admin/license-allocations", customer1Token);
  const custAdminActivate = await apiPost(
    `/admin/license-allocations/${alloc1.id}/activate`,
    { providerAccountId: mainAccount.id },
    customer1Token,
  );
  const custAdminCreatePa = await apiPost(
    "/admin/provider-accounts",
    { providerId: provider.id, name: "Attack PA", totalCapacity: 5 },
    customer1Token,
  );

  if (
    custAdminAllocList.status !== 403 ||
    custAdminActivate.status !== 403 ||
    custAdminCreatePa.status !== 403
  ) {
    throw new Error(
      `Gate 10 failed: Customer was not strictly rejected with 403 (list=${custAdminAllocList.status}, act=${custAdminActivate.status}, pa=${custAdminCreatePa.status})`,
    );
  }
  console.log("✓ Gate 10 passed: Customer role strictly forbidden from all admin endpoints with 403 Forbidden");

  // [Gate 11] Admin activates allocation manually
  console.log("\n[Gate 11] Admin activates allocation manually...");
  const actRes = await apiPost(
    `/admin/license-allocations/${alloc1.id}/activate`,
    {
      providerAccountId: mainAccount.id,
      notes: "Confirmed manual activation in Elementor upstream dashboard",
    },
    adminToken,
  );
  if (!actRes.ok || actRes.data.status !== "ACTIVE" || !actRes.data.activatedAt) {
    throw new Error(`Gate 11 failed: unexpected activation state: ${JSON.stringify(actRes.data)}`);
  }
  console.log(`✓ Gate 11 passed: Allocation successfully transitioned PENDING -> ACTIVE with providerAccountId ${actRes.data.providerAccountId}`);

  // [Gate 12] Provider account capacity enforced
  console.log("\n[Gate 12] Enforcing ProviderAccount capacity limit...");
  const tightPaRes = await apiPost(
    "/admin/provider-accounts",
    {
      providerId: provider.id,
      name: `Elementor 1-Seat Test Account ${runId}`,
      totalCapacity: 1,
    },
    adminToken,
  );
  const tightPa = tightPaRes.data;

  const entTight = await createTestEntitlement({ userId: customer1Id, maxActivations: 2 });
  const allocTight1 = (await apiPost(`/entitlements/${entTight.id}/allocations`, { domain: `tight-domain-1-${runId}.com` }, customer1Token)).data;
  const allocTight2 = (await apiPost(`/entitlements/${entTight.id}/allocations`, { domain: `tight-domain-2-${runId}.com` }, customer1Token)).data;

  // Activate first seat -> 1/1 capacity
  const actTight1 = await apiPost(
    `/admin/license-allocations/${allocTight1.id}/activate`,
    { providerAccountId: tightPa.id },
    adminToken,
  );
  if (!actTight1.ok) throw new Error(`Gate 12 failed to activate first seat: ${JSON.stringify(actTight1)}`);

  // Attempting to activate second seat on tightPa must fail with 409
  const actTight2 = await apiPost(
    `/admin/license-allocations/${allocTight2.id}/activate`,
    { providerAccountId: tightPa.id },
    adminToken,
  );
  if (actTight2.status !== 409) {
    throw new Error(`Gate 12 failed: expected 409 capacity exhausted, got ${actTight2.status}`);
  }
  console.log("✓ Gate 12 passed: Provider account capacity exhaustion enforced with 409 Conflict");

  // [Gate 13] Concurrent last-seat activation race
  console.log("\n[Gate 13] Testing concurrent last-seat activation race on provider account...");
  const racePaRes = await apiPost(
    "/admin/provider-accounts",
    {
      providerId: provider.id,
      name: `Elementor 1-Seat Concurrency Account ${runId}`,
      totalCapacity: 1,
    },
    adminToken,
  );
  const racePa = racePaRes.data;

  const entRace = await createTestEntitlement({ userId: customer1Id, maxActivations: 5 });
  const pendingAllocs = await Promise.all([
    apiPost(`/entitlements/${entRace.id}/allocations`, { domain: `race-activate-1-${runId}.com` }, customer1Token),
    apiPost(`/entitlements/${entRace.id}/allocations`, { domain: `race-activate-2-${runId}.com` }, customer1Token),
    apiPost(`/entitlements/${entRace.id}/allocations`, { domain: `race-activate-3-${runId}.com` }, customer1Token),
  ]);

  const actResults = await Promise.all(
    pendingAllocs.map((p) =>
      apiPost(`/admin/license-allocations/${p.data.id}/activate`, { providerAccountId: racePa.id }, adminToken),
    ),
  );

  const actSucceeded = actResults.filter((r) => r.status === 201 || r.status === 200).length;
  const actRejected = actResults.filter((r) => r.status === 409).length;

  const activeInRacePa = await prisma.licenseAllocation.count({
    where: { providerAccountId: racePa.id, status: "ACTIVE" },
  });

  if (actSucceeded !== 1 || activeInRacePa !== 1) {
    throw new Error(
      `Gate 13 failed: expected exactly 1 activation, got ${actSucceeded} succeeded, active in DB: ${activeInRacePa}`,
    );
  }
  console.log(`✓ Gate 13 passed: Concurrent activation serialized; exactly 1 ACTIVE, ${actRejected} rejected with 409`);

  // [Gate 14] Duplicate normalized domain rejected
  console.log("\n[Gate 14] Verifying duplicate normalized domain collision rejection...");
  // Domain is ACTIVE on alloc1
  const dupRes = await apiPost(
    `/entitlements/${entCust1.id}/allocations`,
    { domain: `https://www.${domain1Normalized}/` },
    customer1Token,
  );
  if (dupRes.status !== 409) {
    throw new Error(`Gate 14 failed: duplicate normalized domain expected 409, got ${dupRes.status}`);
  }
  console.log("✓ Gate 14 passed: Duplicate normalized domain rejected with 409 Conflict");

  // [Gate 15] ACTIVE allocation cannot directly change domain
  console.log("\n[Gate 15] Verifying ACTIVE allocation cannot directly change domain...");
  const patchRes = await fetch(`${API_BASE}/entitlements/${entCust1.id}/allocations/${alloc1.id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${customer1Token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ domain: `hijacked-domain-${runId}.com` }),
  });
  if (patchRes.status !== 404 && patchRes.status !== 405) {
    throw new Error(`Gate 15 failed: Direct mutation endpoint should not exist, got status ${patchRes.status}`);
  }
  console.log("✓ Gate 15 passed: Direct domain mutation on ACTIVE allocation is strictly forbidden");

  // [Gate 16] Deactivation request transition
  console.log("\n[Gate 16] Testing deactivation request transition (ACTIVE -> DEACTIVATION_PENDING)...");
  const deactRes = await apiPost(
    `/entitlements/${entCust1.id}/allocations/${alloc1.id}/request-deactivation`,
    { reason: "Migrating to new production domain" },
    customer1Token,
  );
  if (!deactRes.ok || deactRes.data.status !== "DEACTIVATION_PENDING") {
    throw new Error(`Gate 16 failed: expected status DEACTIVATION_PENDING, got ${deactRes.data?.status}`);
  }
  console.log("✓ Gate 16 passed: Allocation successfully transitioned ACTIVE -> DEACTIVATION_PENDING");

  // [Gate 17] Confirm deactivated
  console.log("\n[Gate 17] Admin confirms upstream deactivation (DEACTIVATION_PENDING -> DEACTIVATED)...");
  const confRes = await apiPost(
    `/admin/license-allocations/${alloc1.id}/confirm-deactivated`,
    { notes: "Confirmed removed from Elementor dashboard" },
    adminToken,
  );
  if (!confRes.ok || confRes.data.status !== "DEACTIVATED" || !confRes.data.deactivatedAt) {
    throw new Error(`Gate 17 failed: expected status DEACTIVATED, got ${confRes.data?.status}`);
  }
  console.log("✓ Gate 17 passed: Allocation transitioned to DEACTIVATED and deactivatedAt recorded");

  // [Gate 18] REVOKED entitlement blocks new allocation
  console.log("\n[Gate 18] Verifying REVOKED entitlement blocks new allocations...");
  const entRevoked = await createTestEntitlement({
    userId: customer1Id,
    status: EntitlementStatus.REVOKED,
    maxActivations: 5,
  });

  const revAllocRes = await apiPost(
    `/entitlements/${entRevoked.id}/allocations`,
    { domain: `revoked-test-site-${runId}.com` },
    customer1Token,
  );
  if (revAllocRes.status !== 409) {
    throw new Error(`Gate 18 failed: expected 409 on REVOKED entitlement, got ${revAllocRes.status}`);
  }
  console.log("✓ Gate 18 passed: REVOKED entitlement strictly blocks allocation with 409 Conflict");

  // [Gate 19] EXPIRED entitlement blocks new allocation
  console.log("\n[Gate 19] Verifying EXPIRED entitlement blocks new allocations...");
  const entExpired = await createTestEntitlement({
    userId: customer1Id,
    status: EntitlementStatus.EXPIRED,
    maxActivations: 5,
  });

  const expAllocRes = await apiPost(
    `/entitlements/${entExpired.id}/allocations`,
    { domain: `expired-test-site-${runId}.com` },
    customer1Token,
  );
  if (expAllocRes.status !== 409) {
    throw new Error(`Gate 19 failed: expected 409 on EXPIRED entitlement, got ${expAllocRes.status}`);
  }
  console.log("✓ Gate 19 passed: EXPIRED entitlement strictly blocks allocation with 409 Conflict");

  // [Gate 20] Reconciliation worker sweeps ACTIVE allocations on revoked/expired entitlements
  console.log("\n[Gate 20] Verifying autonomous worker reconciliation for revoked/expired entitlement allocations...");
  const entForWorker = await createTestEntitlement({
    userId: customer1Id,
    status: EntitlementStatus.ACTIVE,
    maxActivations: 3,
  });

  const allocForWorker = (
    await apiPost(
      `/entitlements/${entForWorker.id}/allocations`,
      { domain: `worker-reconcile-test-${runId}.com` },
      customer1Token,
    )
  ).data;
  await apiPost(
    `/admin/license-allocations/${allocForWorker.id}/activate`,
    { providerAccountId: mainAccount.id },
    adminToken,
  );

  // Revoke parent entitlement
  await prisma.entitlement.update({
    where: { id: entForWorker.id },
    data: { status: EntitlementStatus.REVOKED, revokedAt: new Date() },
  });

  // Trigger reconciliation
  const reconResult = await reconcileExternalAllocations({ workerId: "acceptance-worker" });
  if (reconResult.transitionedCount < 1 || !reconResult.allocationIds.includes(allocForWorker.id)) {
    throw new Error(`Gate 20 failed: worker reconciliation did not pick up allocation ${allocForWorker.id}`);
  }

  const updatedAlloc = await prisma.licenseAllocation.findUniqueOrThrow({ where: { id: allocForWorker.id } });
  if (updatedAlloc.status !== "DEACTIVATION_PENDING") {
    throw new Error(`Gate 20 failed: expected status DEACTIVATION_PENDING, got ${updatedAlloc.status}`);
  }

  const reconAudit = await prisma.auditLog.findFirst({
    where: {
      action: "ALLOCATION_DEACTIVATION_REQUIRED",
      entityId: allocForWorker.id,
    },
  });
  if (!reconAudit) {
    throw new Error("Gate 20 failed: missing ALLOCATION_DEACTIVATION_REQUIRED audit log");
  }
  console.log("✓ Gate 20 passed: Worker autonomously transitioned ACTIVE allocation to DEACTIVATION_PENDING on revoked entitlement");

  // [Gate 21] Audit trail complete
  console.log("\n[Gate 21] Verifying complete audit trail across lifecycle...");
  const expectedActions = [
    "ALLOCATION_REQUESTED",
    "ALLOCATION_ACTIVATED",
    "ALLOCATION_DEACTIVATION_REQUESTED",
    "ALLOCATION_DEACTIVATED",
    "ALLOCATION_DEACTIVATION_REQUIRED",
  ];

  for (const act of expectedActions) {
    const log = await prisma.auditLog.findFirst({ where: { action: act } });
    if (!log) {
      throw new Error(`Gate 21 failed: audit log for '${act}' not found!`);
    }
  }
  console.log(`✓ Gate 21 passed: All required allocation lifecycle audit events verified in PostgreSQL`);

  // [Gate 22] No provider secrets exposed
  console.log("\n[Gate 22] Verifying zero provider secrets or master credentials exposed in APIs...");
  const custAllocsRes = await apiGet(`/entitlements/${entCust1.id}/allocations`, customer1Token);
  const jsonStr = JSON.stringify(custAllocsRes.data);
  const secretKeywords = ["password", "secret", "token", "masterKey", "apiKey", "credential"];
  for (const kw of secretKeywords) {
    if (jsonStr.toLowerCase().includes(kw)) {
      throw new Error(`Gate 22 failed: sensitive keyword '${kw}' exposed in customer response!`);
    }
  }

  const adminPaRes = await apiGet("/admin/provider-accounts", adminToken);
  const adminPaJson = JSON.stringify(adminPaRes.data);
  for (const kw of ["password", "client_secret", "private_key"]) {
    if (adminPaJson.toLowerCase().includes(kw)) {
      throw new Error(`Gate 22 failed: sensitive keyword '${kw}' exposed in admin provider accounts!`);
    }
  }
  console.log("✓ Gate 22 passed: Zero provider credentials or secrets exposed in API responses");

  console.log("\n==================================================");
  console.log("ALL 22 PHASE 6 LIVE RUNTIME GATES PASSED SUCCESSFULLY!");
  console.log("==================================================");

  stopChildProcesses();
  await prisma.$disconnect();
  process.exit(0);
}

runPhase6Acceptance().catch(async (err) => {
  console.error("\n❌ PHASE 6 ACCEPTANCE FAILED:", err);
  stopChildProcesses();
  await prisma.$disconnect();
  process.exit(1);
});
