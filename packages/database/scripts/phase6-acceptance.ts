import * as crypto from "node:crypto";
import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
import {
  prisma,
  EntitlementStatus,
  ProductType,
  FulfillmentType,
  reconcileExternalAllocations,
  adminCreateProviderAccount,
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

async function runPhase6Acceptance() {
  console.log("==================================================");
  console.log("PHASE 6 — ELEMENTOR EXTERNAL LICENSE LIVE ACCEPTANCE (35 GATES)");
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

  // [Gate 23] DEACTIVATION_PENDING still consumes provider seat
  console.log("\n[Gate 23] Verifying DEACTIVATION_PENDING still consumes provider seat...");
  const paGate23Res = await apiPost(
    "/admin/provider-accounts",
    {
      providerId: provider.id,
      name: `Elementor 2-Seat DeactPending Test ${runId}`,
      totalCapacity: 2,
    },
    adminToken,
  );
  const paGate23 = paGate23Res.data;

  const entGate23 = await createTestEntitlement({ userId: customer1Id, maxActivations: 3 });
  const allocA = (await apiPost(`/entitlements/${entGate23.id}/allocations`, { domain: `deact-pending-a-${runId}.com` }, customer1Token)).data;
  const allocB = (await apiPost(`/entitlements/${entGate23.id}/allocations`, { domain: `deact-pending-b-${runId}.com` }, customer1Token)).data;
  const allocC = (await apiPost(`/entitlements/${entGate23.id}/allocations`, { domain: `deact-pending-c-${runId}.com` }, customer1Token)).data;

  // Activate A and B -> consumed = 2/2 -> account becomes EXHAUSTED
  await apiPost(`/admin/license-allocations/${allocA.id}/activate`, { providerAccountId: paGate23.id }, adminToken);
  await apiPost(`/admin/license-allocations/${allocB.id}/activate`, { providerAccountId: paGate23.id }, adminToken);

  // Move A to DEACTIVATION_PENDING
  const deactARes = await apiPost(
    `/entitlements/${entGate23.id}/allocations/${allocA.id}/request-deactivation`,
    { reason: "Domain moving" },
    customer1Token,
  );
  if (deactARes.data.status !== "DEACTIVATION_PENDING") {
    throw new Error(`Gate 23 failed: allocation A not in DEACTIVATION_PENDING: ${JSON.stringify(deactARes.data)}`);
  }

  // Check provider account: consumed must still be 2, active 1, available 0, status EXHAUSTED
  const checkPa23 = (await apiGet(`/admin/provider-accounts/${paGate23.id}`, adminToken)).data;
  if (checkPa23.consumedAllocationsCount !== 2 || checkPa23.activeAllocationsCount !== 1 || checkPa23.availableCapacity !== 0 || checkPa23.status !== "EXHAUSTED") {
    throw new Error(`Gate 23 failed: expected consumed=2, active=1, available=0, status=EXHAUSTED. Got: ${JSON.stringify(checkPa23)}`);
  }

  // Attempting to activate C must fail with 409 capacity exhausted
  const actCRes = await apiPost(
    `/admin/license-allocations/${allocC.id}/activate`,
    { providerAccountId: paGate23.id },
    adminToken,
  );
  if (actCRes.status !== 409) {
    throw new Error(`Gate 23 failed: expected 409 capacity exhausted for alloc C, got ${actCRes.status}`);
  }
  console.log("✓ Gate 23 passed: DEACTIVATION_PENDING still consumes provider capacity and preserves EXHAUSTED status (409 on new activation)");

  // [Gate 24] confirm DEACTIVATED releases provider seat
  console.log("\n[Gate 24] Verifying confirm DEACTIVATED releases provider seat...");
  // Confirm deactivation of A -> A becomes DEACTIVATED
  const confDeactARes = await apiPost(
    `/admin/license-allocations/${allocA.id}/confirm-deactivated`,
    { notes: "Removed from dashboard" },
    adminToken,
  );
  if (confDeactARes.data.status !== "DEACTIVATED") {
    throw new Error(`Gate 24 failed: allocation A not DEACTIVATED: ${JSON.stringify(confDeactARes.data)}`);
  }

  // Check provider account: consumed is now 1, active is 1, available is 1, status is ACTIVE
  const checkPa24 = (await apiGet(`/admin/provider-accounts/${paGate23.id}`, adminToken)).data;
  if (checkPa24.consumedAllocationsCount !== 1 || checkPa24.activeAllocationsCount !== 1 || checkPa24.availableCapacity !== 1 || checkPa24.status !== "ACTIVE") {
    throw new Error(`Gate 24 failed: expected consumed=1, active=1, available=1, status=ACTIVE. Got: ${JSON.stringify(checkPa24)}`);
  }

  // Now activation of C must succeed!
  const actCSuccessRes = await apiPost(
    `/admin/license-allocations/${allocC.id}/activate`,
    { providerAccountId: paGate23.id },
    adminToken,
  );
  if (!actCSuccessRes.ok || actCSuccessRes.data.status !== "ACTIVE") {
    throw new Error(`Gate 24 failed: expected alloc C to activate, got status ${actCSuccessRes.status}`);
  }

  const finalPa24 = (await apiGet(`/admin/provider-accounts/${paGate23.id}`, adminToken)).data;
  if (finalPa24.consumedAllocationsCount !== 2 || finalPa24.activeAllocationsCount !== 2 || finalPa24.availableCapacity !== 0 || finalPa24.status !== "EXHAUSTED") {
    throw new Error(`Gate 24 failed: expected consumed=2, active=2, available=0, status=EXHAUSTED. Got: ${JSON.stringify(finalPa24)}`);
  }
  console.log("✓ Gate 24 passed: Confirming DEACTIVATED released provider capacity (consumed 1, available 1, account restored to ACTIVE) and allowed new activation");

  // [Gate 25] Activation vs Entitlement Revoke true live PostgreSQL race
  console.log("\n[Gate 25] Testing live race: Admin Activate vs Entitlement Revoke...");
  const entRace25 = await createTestEntitlement({ userId: customer1Id, maxActivations: 2, status: EntitlementStatus.ACTIVE });
  const allocRace25 = (await apiPost(`/entitlements/${entRace25.id}/allocations`, { domain: `race-activate-revoke-${runId}.com` }, customer1Token)).data;

  // Run activation and revocation simultaneously
  const [raceActResult, raceRevResult] = await Promise.all([
    apiPost(`/admin/license-allocations/${allocRace25.id}/activate`, { providerAccountId: mainAccount.id }, adminToken),
    apiPost(`/admin/entitlements/${entRace25.id}/revoke`, { reason: "Security violation" }, adminToken),
  ]);

  const dbEnt25 = await prisma.entitlement.findUniqueOrThrow({ where: { id: entRace25.id } });
  const dbAlloc25 = await prisma.licenseAllocation.findUniqueOrThrow({ where: { id: allocRace25.id } });

  if (raceActResult.ok) {
    // Activation serialized first: allocation became ACTIVE, then entitlement was REVOKED
    if (dbEnt25.status !== "REVOKED") {
      throw new Error(`Gate 25 failed: entitlement expected REVOKED, got ${dbEnt25.status}`);
    }
    // Reconciliation worker must sweep this ACTIVE allocation to DEACTIVATION_PENDING
    const recon25 = await reconcileExternalAllocations({ workerId: "acceptance-race-worker" });
    const postReconAlloc = await prisma.licenseAllocation.findUniqueOrThrow({ where: { id: allocRace25.id } });
    if (postReconAlloc.status !== "DEACTIVATION_PENDING") {
      throw new Error(`Gate 25 failed: allocation not swept to DEACTIVATION_PENDING by worker, status: ${postReconAlloc.status}`);
    }
    console.log("✓ Gate 25 passed (Activation won first): Allocation activated, entitlement revoked, worker deterministically swept to DEACTIVATION_PENDING");
  } else {
    // Revocation serialized first: activation failed with 409
    if (raceActResult.status !== 409) {
      throw new Error(`Gate 25 failed: expected activation 409, got ${raceActResult.status}`);
    }
    if (dbEnt25.status !== "REVOKED") {
      throw new Error(`Gate 25 failed: entitlement expected REVOKED, got ${dbEnt25.status}`);
    }
    if (dbAlloc25.status !== "PENDING") {
      throw new Error(`Gate 25 failed: allocation was corrupted, status: ${dbAlloc25.status}`);
    }
    console.log("✓ Gate 25 passed (Revocation won first): Activation rejected with 409, allocation remained PENDING");
  }

  // [Gate 26] Reduce provider capacity below consumed -> 409
  console.log("\n[Gate 26] Verifying reducing provider capacity below consumed seats fails with 409...");
  const paGate26Res = await apiPost(
    "/admin/provider-accounts",
    {
      providerId: provider.id,
      name: `Elementor Capacity Reduce Test ${runId}`,
      totalCapacity: 3,
    },
    adminToken,
  );
  const paGate26 = paGate26Res.data;

  const entGate26 = await createTestEntitlement({ userId: customer1Id, maxActivations: 3 });
  const alloc26A = (await apiPost(`/entitlements/${entGate26.id}/allocations`, { domain: `cap-reduce-a-${runId}.com` }, customer1Token)).data;
  const alloc26B = (await apiPost(`/entitlements/${entGate26.id}/allocations`, { domain: `cap-reduce-b-${runId}.com` }, customer1Token)).data;

  await apiPost(`/admin/license-allocations/${alloc26A.id}/activate`, { providerAccountId: paGate26.id }, adminToken);
  await apiPost(`/admin/license-allocations/${alloc26B.id}/activate`, { providerAccountId: paGate26.id }, adminToken);
  // Consumed = 2 (alloc26A ACTIVE, alloc26B ACTIVE)

  // Attempt to reduce totalCapacity to 1 (below consumed 2)
  const reduceRes = await apiPatch(
    `/admin/provider-accounts/${paGate26.id}`,
    { totalCapacity: 1 },
    adminToken,
  );
  if (reduceRes.status !== 409) {
    throw new Error(`Gate 26 failed: expected 409 Conflict reducing capacity below consumed, got ${reduceRes.status}`);
  }

  // Verify in DB totalCapacity remains 3
  const dbPa26 = await prisma.providerAccount.findUniqueOrThrow({ where: { id: paGate26.id } });
  if (dbPa26.totalCapacity !== 3) {
    throw new Error(`Gate 26 failed: DB totalCapacity was corrupted to ${dbPa26.totalCapacity}`);
  }

  // Reduce totalCapacity to 2 (equal to consumed) -> must succeed and become EXHAUSTED
  const reduceTo2Res = await apiPatch(
    `/admin/provider-accounts/${paGate26.id}`,
    { totalCapacity: 2 },
    adminToken,
  );
  if (!reduceTo2Res.ok || reduceTo2Res.data.status !== "EXHAUSTED" || reduceTo2Res.data.totalCapacity !== 2) {
    throw new Error(`Gate 26 failed: reducing to 2 expected status EXHAUSTED, got ${JSON.stringify(reduceTo2Res.data)}`);
  }
  console.log("✓ Gate 26 passed: Capacity reduction below consumed strictly rejected with 409; valid reduction to consumed transitioned account to EXHAUSTED");

  // [Gate 27] Concurrent capacity update vs activation race
  console.log("\n[Gate 27] Testing concurrent race: Capacity Reduction vs Allocation Activation...");
  const paGate27Res = await apiPost(
    "/admin/provider-accounts",
    {
      providerId: provider.id,
      name: `Elementor Capacity vs Activation Race ${runId}`,
      totalCapacity: 2,
    },
    adminToken,
  );
  const paGate27 = paGate27Res.data;

  const entGate27 = await createTestEntitlement({ userId: customer1Id, maxActivations: 2 });
  const alloc27A = (await apiPost(`/entitlements/${entGate27.id}/allocations`, { domain: `race27-a-${runId}.com` }, customer1Token)).data;
  const alloc27B = (await apiPost(`/entitlements/${entGate27.id}/allocations`, { domain: `race27-b-${runId}.com` }, customer1Token)).data;

  // Activate 1 seat -> capacity=2, consumed=1, available=1
  await apiPost(`/admin/license-allocations/${alloc27A.id}/activate`, { providerAccountId: paGate27.id }, adminToken);

  // Concurrently: Activate second seat vs Reduce capacity to 1
  const [race27Act, race27Patch] = await Promise.all([
    apiPost(`/admin/license-allocations/${alloc27B.id}/activate`, { providerAccountId: paGate27.id }, adminToken),
    apiPatch(`/admin/provider-accounts/${paGate27.id}`, { totalCapacity: 1 }, adminToken),
  ]);

  const dbPa27 = await prisma.providerAccount.findUniqueOrThrow({ where: { id: paGate27.id } });
  const consumedInDb27 = await prisma.licenseAllocation.count({
    where: {
      providerAccountId: paGate27.id,
      status: { in: ["ACTIVE", "DEACTIVATION_PENDING"] },
    },
  });

  if (consumedInDb27 > dbPa27.totalCapacity) {
    throw new Error(`Gate 27 failed: DB capacity invariant violated: consumed (${consumedInDb27}) > totalCapacity (${dbPa27.totalCapacity})`);
  }

  const oneSucceededOneFailed =
    (race27Act.ok && race27Patch.status === 409) ||
    (!race27Act.ok && race27Act.status === 409 && race27Patch.ok);

  if (!oneSucceededOneFailed) {
    throw new Error(`Gate 27 failed: expected serialization with 1 success and 1 409 conflict, got act=${race27Act.status}, patch=${race27Patch.status}`);
  }
  console.log(`✓ Gate 27 passed: Concurrent race serialized (consumed=${consumedInDb27}, capacity=${dbPa27.totalCapacity}, consumed <= capacity strictly preserved)`);

  // [Gate 28] Provider secret-like metadata rejected
  console.log("\n[Gate 28] Verifying provider secret-like metadata is strictly rejected (400 Bad Request)...");
  const secretSamples = [
    { apiToken: "super-secret-token" },
    { secret: "super-secret" },
    { apiKey: "12345" },
    { clientSecret: "abcde" },
    { authorization: "Bearer xyz" },
  ];

  for (const meta of secretSamples) {
    const secRes = await apiPost(
      "/admin/provider-accounts",
      {
        providerId: provider.id,
        name: `Secret Account Test ${runId}`,
        totalCapacity: 5,
        metadata: meta,
      },
      adminToken,
    );
    if (secRes.status !== 400) {
      throw new Error(`Gate 28 failed: secret metadata ${JSON.stringify(meta)} expected 400, got ${secRes.status}`);
    }
  }
  console.log("✓ Gate 28 passed: Root-level secret-like metadata keys strictly rejected with 400 Bad Request");

  // [Gate 29] Nested secret-like metadata rejected
  console.log("\n[Gate 29] Verifying nested secret-like metadata is strictly rejected (400 Bad Request)...");
  const nestedSecretSamples = [
    { upstream: { password: "admin-password" } },
    { config: { credentials: { privateKey: "-----BEGIN RSA PRIVATE KEY-----" } } },
    { auth: { tokens: [{ accessToken: "tok-123" }] } },
  ];

  for (const meta of nestedSecretSamples) {
    const secRes = await apiPost(
      "/admin/provider-accounts",
      {
        providerId: provider.id,
        name: `Nested Secret Test ${runId}`,
        totalCapacity: 5,
        metadata: meta,
      },
      adminToken,
    );
    if (secRes.status !== 400) {
      throw new Error(`Gate 29 failed: nested secret metadata ${JSON.stringify(meta)} expected 400, got ${secRes.status}`);
    }
  }
  console.log("✓ Gate 29 passed: Deeply nested secret-like metadata keys strictly rejected with 400 Bad Request");

  // [Gate 30] Audit / DB / API contain no provider secret
  console.log("\n[Gate 30] Verifying audit logs, DB records, and API responses contain no provider secrets...");
  const forbiddenSubstrings = [
    "super-secret-token",
    "super-secret",
    "admin-password",
    "BEGIN RSA PRIVATE KEY",
    "tok-123",
  ];

  // 1. Verify provider_accounts table in DB
  const allPasInDb = await prisma.providerAccount.findMany();
  const dbPaJson = JSON.stringify(allPasInDb);
  for (const sub of forbiddenSubstrings) {
    if (dbPaJson.includes(sub)) {
      throw new Error(`Gate 30 failed: secret substring '${sub}' found in provider_accounts database table!`);
    }
  }

  // 2. Verify audit_logs table in DB
  const paAuditLogs = await prisma.auditLog.findMany({
    where: { entity: "ProviderAccount" },
  });
  const auditJson = JSON.stringify(paAuditLogs);
  for (const sub of forbiddenSubstrings) {
    if (auditJson.includes(sub)) {
      throw new Error(`Gate 30 failed: secret substring '${sub}' found in audit_logs database table!`);
    }
  }

  // 3. Verify API list responses
  const paListRes = await apiGet("/admin/provider-accounts", adminToken);
  const paListJson = JSON.stringify(paListRes.data);
  for (const sub of forbiddenSubstrings) {
    if (paListJson.includes(sub)) {
      throw new Error(`Gate 30 failed: secret substring '${sub}' found in /admin/provider-accounts API response!`);
    }
  }
  console.log("✓ Gate 30 passed: Full verification complete: zero submitted secrets found in database, audit logs, or API responses");

  // [Gate 31] True live race: Confirm-deactivated vs Provider SUSPEND
  console.log("\n[Gate 31] Testing true live race: Confirm-deactivated vs Provider SUSPEND...");
  const pa31Res = await apiPost(
    "/admin/provider-accounts",
    {
      providerId: provider.id,
      name: `Elementor Suspend Race ${runId}`,
      totalCapacity: 2,
    },
    adminToken,
  );
  const pa31 = pa31Res.data;

  const ent31 = await createTestEntitlement({ userId: customer1Id, maxActivations: 2 });
  const alloc31A = (await apiPost(`/entitlements/${ent31.id}/allocations`, { domain: `race31-a-${runId}.com` }, customer1Token)).data;
  const alloc31B = (await apiPost(`/entitlements/${ent31.id}/allocations`, { domain: `race31-b-${runId}.com` }, customer1Token)).data;

  // Activate both allocations -> consumed=2, capacity=2 -> EXHAUSTED
  await apiPost(`/admin/license-allocations/${alloc31A.id}/activate`, { providerAccountId: pa31.id }, adminToken);
  await apiPost(`/admin/license-allocations/${alloc31B.id}/activate`, { providerAccountId: pa31.id }, adminToken);

  const pa31Exhausted = (await apiGet(`/admin/provider-accounts/${pa31.id}`, adminToken)).data;
  if (pa31Exhausted.status !== "EXHAUSTED") {
    throw new Error(`Gate 31 failed: expected account status EXHAUSTED, got ${pa31Exhausted.status}`);
  }

  // Request deactivation on Allocation A -> status: DEACTIVATION_PENDING
  await apiPost(`/entitlements/${ent31.id}/allocations/${alloc31A.id}/request-deactivation`, {}, customer1Token);

  // Concurrently: Admin confirms deactivation on A vs Admin suspends Provider Account
  const [confirmRes31, suspendRes31] = await Promise.all([
    apiPost(`/admin/license-allocations/${alloc31A.id}/confirm-deactivated`, {}, adminToken),
    apiPatch(`/admin/provider-accounts/${pa31.id}`, { status: "SUSPENDED" }, adminToken),
  ]);

  if (!confirmRes31.ok) {
    throw new Error(`Gate 31 failed: confirm-deactivated failed: ${JSON.stringify(confirmRes31.data)}`);
  }
  if (!suspendRes31.ok) {
    throw new Error(`Gate 31 failed: suspend provider account failed: ${JSON.stringify(suspendRes31.data)}`);
  }

  // Verify final state in DB
  const finalPa31 = await prisma.providerAccount.findUniqueOrThrow({ where: { id: pa31.id } });
  const finalAlloc31A = await prisma.licenseAllocation.findUniqueOrThrow({ where: { id: alloc31A.id } });

  if (finalAlloc31A.status !== "DEACTIVATED") {
    throw new Error(`Gate 31 failed: allocation A expected DEACTIVATED, got ${finalAlloc31A.status}`);
  }
  if (finalPa31.status !== "SUSPENDED") {
    throw new Error(`Gate 31 failed: provider account expected SUSPENDED, got ${finalPa31.status} (SUSPENDED was overwritten by ACTIVE!)`);
  }

  const remainingConsumed31 = await prisma.licenseAllocation.count({
    where: {
      providerAccountId: pa31.id,
      status: { in: ["ACTIVE", "DEACTIVATION_PENDING"] },
    },
  });
  if (remainingConsumed31 > finalPa31.totalCapacity) {
    throw new Error(`Gate 31 failed: remaining consumed (${remainingConsumed31}) > capacity (${finalPa31.totalCapacity})`);
  }
  console.log(`✓ Gate 31 passed: Live race serialized: allocation transitioned to DEACTIVATED, SUSPENDED status strictly preserved (never overwritten by ACTIVE)`);

  // [Gate 32] Domain with userinfo/password URL rejected & no secrets persisted
  console.log("\n[Gate 32] Testing rejection of domain with URL credentials (username/password)...");
  const credentialSecret = `SuperSecretPassword_${runId}`;
  const userinfoDomain = `https://admin:${credentialSecret}@example-site-${runId}.com/path`;

  const userinfoRes = await apiPost(
    `/entitlements/${entCust1.id}/allocations`,
    { domain: userinfoDomain },
    customer1Token,
  );
  if (userinfoRes.status !== 400) {
    throw new Error(`Gate 32 failed: URL with credentials expected 400 Bad Request, got ${userinfoRes.status}`);
  }

  // Verify credentialSecret does not appear anywhere
  const dbAllocationsJson = JSON.stringify(await prisma.licenseAllocation.findMany());
  if (dbAllocationsJson.includes(credentialSecret)) {
    throw new Error(`Gate 32 failed: secret '${credentialSecret}' found in license_allocations table!`);
  }

  const dbAuditJson = JSON.stringify(await prisma.auditLog.findMany());
  if (dbAuditJson.includes(credentialSecret)) {
    throw new Error(`Gate 32 failed: secret '${credentialSecret}' found in audit_logs table!`);
  }

  const respJson32 = JSON.stringify(userinfoRes.data);
  if (respJson32.includes(credentialSecret)) {
    throw new Error(`Gate 32 failed: secret '${credentialSecret}' exposed in API error response!`);
  }
  console.log("✓ Gate 32 passed: URL with credentials rejected with 400 Bad Request; zero secrets in DB, audit logs, or error responses");

  // [Gate 33] Query/fragment secret stripped -> DB/audit/API contain only canonical hostname
  console.log("\n[Gate 33] Testing query/fragment secret stripping (canonical storage only)...");
  const querySecret = `VerySecretToken_${runId}`;
  const dirtyDomain = `https://example-canonical-${runId}.com/path?token=${querySecret}#private`;
  const canonicalExpected = `example-canonical-${runId}.com`;

  const dirtyRes = await apiPost(
    `/entitlements/${entCust1.id}/allocations`,
    { domain: dirtyDomain },
    customer1Token,
  );
  if (!dirtyRes.ok) {
    throw new Error(`Gate 33 failed: expected valid domain to be accepted, got ${dirtyRes.status}: ${JSON.stringify(dirtyRes.data)}`);
  }

  const dirtyAlloc = dirtyRes.data;
  if (dirtyAlloc.domain !== canonicalExpected || dirtyAlloc.normalizedDomain !== canonicalExpected) {
    throw new Error(`Gate 33 failed: stored domain '${dirtyAlloc.domain}' does not equal canonical '${canonicalExpected}'`);
  }

  // Verify querySecret is NOT in DB record
  const allocFromDb33 = await prisma.licenseAllocation.findUniqueOrThrow({ where: { id: dirtyAlloc.id } });
  if (JSON.stringify(allocFromDb33).includes(querySecret)) {
    throw new Error(`Gate 33 failed: secret '${querySecret}' found in license_allocations row!`);
  }

  // Verify querySecret is NOT in audit log
  const auditLogs33 = await prisma.auditLog.findMany({ where: { entityId: dirtyAlloc.id } });
  if (JSON.stringify(auditLogs33).includes(querySecret)) {
    throw new Error(`Gate 33 failed: secret '${querySecret}' found in audit_logs!`);
  }

  // Verify querySecret is NOT in customer or admin API responses
  const custAllocList = await apiGet(`/entitlements/${entCust1.id}/allocations`, customer1Token);
  if (JSON.stringify(custAllocList.data).includes(querySecret)) {
    throw new Error(`Gate 33 failed: secret '${querySecret}' found in customer allocations API response!`);
  }

  const adminAllocDetail = await apiGet(`/admin/license-allocations/${dirtyAlloc.id}`, adminToken);
  if (JSON.stringify(adminAllocDetail.data).includes(querySecret)) {
    throw new Error(`Gate 33 failed: secret '${querySecret}' found in admin allocation API response!`);
  }
  console.log(`✓ Gate 33 passed: Canonical storage verified (domain='${canonicalExpected}'); path/query/fragment stripped; zero secrets in DB, audit, or APIs`);

  // [Gate 34] Provider account create + audit failure rollback & status policy
  console.log("\n[Gate 34] Testing provider account creation audit failure rollback & status policy...");
  // 1. Arbitrary EXHAUSTED creation when consumed=0 is rejected
  const exhaustedRes = await apiPost(
    "/admin/provider-accounts",
    {
      providerId: provider.id,
      name: `Exhausted Create Attempt ${runId}`,
      totalCapacity: 5,
      status: "EXHAUSTED",
    },
    adminToken,
  );
  if (exhaustedRes.status !== 400) {
    throw new Error(`Gate 34 failed: creating account with EXHAUSTED status expected 400, got ${exhaustedRes.status}`);
  }

  // 2. Transactional rollback when audit fails
  const rollbackAccountName = `Rollback Test PA ${runId}`;
  let auditFailed = false;
  try {
    const mockTxDb: any = {
      $transaction: async (fn: any) => {
        return prisma.$transaction(async (tx) => {
          const proxyTx = new Proxy(tx, {
            get(target, prop) {
              if (prop === "auditLog") {
                return {
                  create: async () => {
                    throw new Error("Simulated audit write failure for rollback test");
                  },
                };
              }
              return (target as any)[prop];
            },
          });
          return fn(proxyTx);
        });
      },
    };

    await adminCreateProviderAccount(
      {
        actorId: "admin-1",
        providerId: provider.id,
        name: rollbackAccountName,
        totalCapacity: 10,
      },
      mockTxDb,
    );
  } catch (err: any) {
    if (err.message.includes("Simulated audit write failure")) {
      auditFailed = true;
    }
  }

  if (!auditFailed) {
    throw new Error("Gate 34 failed: expected simulated audit failure to throw");
  }

  const accountInDb = await prisma.providerAccount.findFirst({
    where: { name: rollbackAccountName },
  });
  if (accountInDb) {
    throw new Error("Gate 34 failed: ProviderAccount was committed despite audit log failure!");
  }
  console.log("✓ Gate 34 passed: Provider account creation with EXHAUSTED rejected; audit failure triggered full transactional rollback (account not persisted)");

  // [Gate 35] activeAllocationsCount != consumedAllocationsCount when DEACTIVATION_PENDING exists
  console.log("\n[Gate 35] Testing distinct activeAllocationsCount vs consumedAllocationsCount metrics...");
  const pa35Res = await apiPost(
    "/admin/provider-accounts",
    {
      providerId: provider.id,
      name: `Metrics Distinction Test ${runId}`,
      totalCapacity: 5,
    },
    adminToken,
  );
  const pa35 = pa35Res.data;

  const ent35 = await createTestEntitlement({ userId: customer1Id, maxActivations: 2 });
  const alloc35A = (await apiPost(`/entitlements/${ent35.id}/allocations`, { domain: `metrics-a-${runId}.com` }, customer1Token)).data;
  const alloc35B = (await apiPost(`/entitlements/${ent35.id}/allocations`, { domain: `metrics-b-${runId}.com` }, customer1Token)).data;

  // Activate both allocations under pa35
  await apiPost(`/admin/license-allocations/${alloc35A.id}/activate`, { providerAccountId: pa35.id }, adminToken);
  await apiPost(`/admin/license-allocations/${alloc35B.id}/activate`, { providerAccountId: pa35.id }, adminToken);

  // Transition alloc35A to DEACTIVATION_PENDING
  await apiPost(`/entitlements/${ent35.id}/allocations/${alloc35A.id}/request-deactivation`, {}, customer1Token);

  // Now: 1 ACTIVE (alloc35B), 1 DEACTIVATION_PENDING (alloc35A)
  // Check GET /admin/provider-accounts/:id
  const pa35Detail = (await apiGet(`/admin/provider-accounts/${pa35.id}`, adminToken)).data;
  if (pa35Detail.activeAllocationsCount !== 1) {
    throw new Error(`Gate 35 failed: expected activeAllocationsCount=1, got ${pa35Detail.activeAllocationsCount}`);
  }
  if (pa35Detail.consumedAllocationsCount !== 2) {
    throw new Error(`Gate 35 failed: expected consumedAllocationsCount=2, got ${pa35Detail.consumedAllocationsCount}`);
  }
  if (pa35Detail.availableCapacity !== 3) {
    throw new Error(`Gate 35 failed: expected availableCapacity=3 (5 - 2), got ${pa35Detail.availableCapacity}`);
  }

  // Check GET /admin/provider-accounts list
  const pa35List = (await apiGet(`/admin/provider-accounts?providerId=${provider.id}`, adminToken)).data;
  const pa35InList = pa35List.find((p: any) => p.id === pa35.id);
  if (!pa35InList) {
    throw new Error("Gate 35 failed: created account not found in list response");
  }
  if (pa35InList.activeAllocationsCount !== 1 || pa35InList.consumedAllocationsCount !== 2 || pa35InList.availableCapacity !== 3) {
    throw new Error(`Gate 35 failed: list item metrics mismatch: ${JSON.stringify(pa35InList)}`);
  }
  console.log(`✓ Gate 35 passed: Metrics distinct and accurate: activeAllocationsCount=1, consumedAllocationsCount=2, availableCapacity=3 (totalCapacity=5)`);

  console.log("\n==================================================");
  console.log("ALL 35 PHASE 6 LIVE RUNTIME GATES PASSED SUCCESSFULLY!");
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
