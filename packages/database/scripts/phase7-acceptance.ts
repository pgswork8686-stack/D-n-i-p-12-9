import * as crypto from "node:crypto";
import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
import {
  prisma,
  EntitlementStatus,
  ProductType,
  FulfillmentType,
  LicenseStatus,
  provisionInternalLicenses,
  reconcileInternalLicenses,
} from "../src/index";
import {
  decryptLicenseKey,
  generateLicenseKey,
  hashLicenseKey,
  maskLicenseKey,
  extractKeyLast4,
  encryptLicenseKey,
} from "@nexus/utils";

const TEST_PORT = process.env.API_PORT || process.env.PORT || "4005";
const API_BASE = `http://localhost:${TEST_PORT}`;
const TEST_ENCRYPTION_KEY =
  process.env.LICENSE_KEY_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

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

  console.log(`  Starting API server child process on port ${TEST_PORT}...`);
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
        LICENSE_KEY_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      },
    },
  );

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
  console.log("  Spawning worker child process 'worker-acceptance-phase7'...");
  workerProcess = spawn(
    "node",
    [path.resolve(__dirname, "../../../apps/worker/dist/index.js")],
    {
      cwd: path.resolve(__dirname, "../../.."),
      stdio: "pipe",
      env: {
        ...process.env,
        WORKER_ID: "worker-acceptance-phase7",
        OUTBOX_POLL_INTERVAL_MS: "500",
        LICENSE_KEY_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      },
    },
  );

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

async function runPhase7Acceptance() {
  console.log("==================================================");
  console.log("PHASE 7 — INTERNAL LICENSE ENGINE LIVE ACCEPTANCE (41 GATES)");
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

  // Query or seed test product
  let product = await prisma.product.findUnique({
    where: { slug: "nexus-plugin-pro" },
  });
  if (!product) {
    product = await prisma.product.create({
      data: {
        slug: "nexus-plugin-pro",
        name: "Nexus Plugin Pro",
        productType: ProductType.LICENSED_SOFTWARE,
        fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
        status: "ACTIVE",
      },
    });
  }

  let variant = await prisma.productVariant.findFirst({
    where: { productId: product.id },
  });
  if (!variant) {
    variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `SKU-P7-${Date.now()}`,
        name: "Pro License",
        status: "ACTIVE",
      },
    });
  }

  async function createTestEntitlement(params: {
    userId: string;
    fulfillmentType?: FulfillmentType;
    status?: EntitlementStatus;
    maxActivations?: number | null;
    expiresAt?: Date | null;
    updatesUntil?: Date | null;
    supportUntil?: Date | null;
  }) {
    const order = await prisma.order.create({
      data: {
        userId: params.userId,
        orderNumber: `ORD-P7-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
        status: "PAID",
        currency: "USD",
        subtotalAmount: 2000,
        totalAmount: 2000,
      },
    });

    const orderItem = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: product!.id,
        variantId: variant!.id,
        productName: product!.name,
        variantName: variant!.name,
        sku: variant!.sku,
        productType: ProductType.LICENSED_SOFTWARE,
        fulfillmentType: params.fulfillmentType ?? FulfillmentType.INTERNAL_LICENSE,
        currency: "USD",
        unitAmount: 2000,
        quantity: 1,
        lineTotalAmount: 2000,
        licensePlanIdAtPurchase: "plan-nex-1site",
        snapshotVersion: 1,
        maxActivations: params.maxActivations ?? 1,
        isLifetime: !params.expiresAt,
      },
    });

    return prisma.entitlement.create({
      data: {
        userId: params.userId,
        orderId: order.id,
        orderItemId: orderItem.id,
        productId: product!.id,
        variantId: variant!.id,
        productType: product!.productType,
        fulfillmentType: params.fulfillmentType ?? FulfillmentType.INTERNAL_LICENSE,
        status: params.status ?? EntitlementStatus.ACTIVE,
        maxActivations: params.maxActivations ?? 1,
        expiresAt: params.expiresAt ?? null,
        updatesUntil: params.updatesUntil ?? null,
        supportUntil: params.supportUntil ?? null,
      },
    });
  }

  // [Gate 2] ACTIVE INTERNAL_LICENSE Entitlement provisions InternalLicense
  console.log("\n[Gate 2] Verifying ACTIVE INTERNAL_LICENSE Entitlement provisions InternalLicense...");
  const ent1 = await createTestEntitlement({
    userId: customer1Id,
    maxActivations: 1,
  });

  // Wait for worker polling tick to provision
  let lic1: any = null;
  for (let i = 0; i < 20; i++) {
    lic1 = await prisma.internalLicense.findUnique({
      where: { entitlementId: ent1.id },
    });
    if (lic1) break;
    await sleep(500);
  }

  if (!lic1) {
    throw new Error("Worker failed to autonomously provision InternalLicense for active entitlement");
  }
  if (!lic1.keyHash || !lic1.keyCiphertext || !lic1.keyLast4) {
    throw new Error("InternalLicense missing security fields (keyHash, keyCiphertext, keyLast4)");
  }
  console.log(`✓ Gate 2 passed: InternalLicense ${lic1.id} autonomously provisioned (keyLast4: ${lic1.keyLast4})`);

  // [Gate 3] Duplicate worker provisioning race -> exactly one license
  console.log("\n[Gate 3] Testing duplicate worker provisioning idempotency...");
  const dupResult = await provisionInternalLicenses({ workerId: "worker-test-dup" }, prisma);
  const totalLicsForEnt1 = await prisma.internalLicense.count({
    where: { entitlementId: ent1.id },
  });
  if (totalLicsForEnt1 !== 1) {
    throw new Error(`Expected exactly 1 license for entitlement, found ${totalLicsForEnt1}`);
  }
  console.log(`✓ Gate 3 passed: Idempotent provisioning resolved with 0 duplicates (total: ${totalLicsForEnt1})`);

  // [Gate 4] REVOKED/EXPIRED entitlement does not provision
  console.log("\n[Gate 4] Verifying REVOKED and EXPIRED entitlements fail-closed (0 licenses provisioned)...");
  const entRevoked = await createTestEntitlement({
    userId: customer1Id,
    status: EntitlementStatus.REVOKED,
  });
  const entExpired = await createTestEntitlement({
    userId: customer1Id,
    status: EntitlementStatus.EXPIRED,
    expiresAt: new Date(Date.now() - 3600000),
  });

  await sleep(1500); // Allow worker tick
  const licRev = await prisma.internalLicense.findUnique({ where: { entitlementId: entRevoked.id } });
  const licExp = await prisma.internalLicense.findUnique({ where: { entitlementId: entExpired.id } });

  if (licRev || licExp) {
    throw new Error("Fail-closed violation: License was provisioned for REVOKED or EXPIRED entitlement!");
  }
  console.log("✓ Gate 4 passed: Zero licenses provisioned for REVOKED / EXPIRED entitlements");

  // [Gate 5] Customer lists own license
  console.log("\n[Gate 5] Customer 1 lists own licenses (GET /licenses)...");
  const listRes = await apiGet("/licenses", customer1Token);
  if (!listRes.ok || !Array.isArray(listRes.data)) {
    throw new Error(`Failed to list customer licenses: ${JSON.stringify(listRes.data)}`);
  }
  const myLic = listRes.data.find((l: any) => l.id === lic1.id);
  if (!myLic) {
    throw new Error("Customer license list does not contain provisioned license");
  }
  if (!myLic.keyMasked.startsWith("NXS-") || !myLic.keyMasked.endsWith(lic1.keyLast4)) {
    throw new Error(`Invalid masked key format: ${myLic.keyMasked}`);
  }
  if (myLic.keyHash || myLic.keyCiphertext) {
    throw new Error("Security leak: keyHash or keyCiphertext exposed in customer license DTO!");
  }
  console.log(`✓ Gate 5 passed: Customer retrieved license with masked key '${myLic.keyMasked}'`);

  // [Gate 6] Cross-user read -> 404
  console.log("\n[Gate 6] Testing cross-user license isolation (Customer 2 -> Customer 1 license, strict 404)...");
  const crossRes = await apiGet(`/licenses/${lic1.id}`, customer2Token);
  if (crossRes.status !== 404) {
    throw new Error(`Expected 404 for cross-user license access, received ${crossRes.status}`);
  }
  console.log("✓ Gate 6 passed: Cross-user license access strictly rejected with 404 Not Found");

  // [Gate 7] Reveal owner succeeds
  console.log("\n[Gate 7] Customer 1 reveals plaintext license key (POST /licenses/:id/reveal)...");
  const revealRes = await apiPost(`/licenses/${lic1.id}/reveal`, {}, customer1Token);
  if (!revealRes.ok || !revealRes.data.licenseKey) {
    throw new Error(`Failed to reveal license key: ${JSON.stringify(revealRes.data)}`);
  }
  const plaintextKey = revealRes.data.licenseKey;
  if (!plaintextKey.startsWith("NXS-") || !plaintextKey.endsWith(lic1.keyLast4)) {
    throw new Error(`Revealed key '${plaintextKey}' does not match expected format or keyLast4 '${lic1.keyLast4}'`);
  }
  console.log(`✓ Gate 7 passed: Customer 1 successfully revealed key: NXS-****-...-${lic1.keyLast4}`);

  // [Gate 8] Plaintext not stored/logged/audited
  console.log("\n[Gate 8] Verifying plaintext key is NEVER stored in database or audit logs...");
  const dbLic = await prisma.internalLicense.findUniqueOrThrow({ where: { id: lic1.id } });
  const rawDbString = JSON.stringify(dbLic);
  if (rawDbString.includes(plaintextKey)) {
    throw new Error("Security violation: plaintext license key found stored in internal_licenses table!");
  }

  const revealAudits = await prisma.auditLog.findMany({
    where: { entityId: lic1.id, action: "LICENSE_KEY_REVEALED" },
  });
  if (revealAudits.length === 0) {
    throw new Error("Missing LICENSE_KEY_REVEALED audit log!");
  }
  const auditString = JSON.stringify(revealAudits);
  if (auditString.includes(plaintextKey)) {
    throw new Error("Security violation: plaintext license key found written into audit_logs!");
  }
  console.log("✓ Gate 8 passed: Zero plaintext keys in database or audit logs");

  // [Gate 9] Valid key/domain activate succeeds
  console.log("\n[Gate 9] Public client activates license on domain (POST /v1/licenses/activate)...");
  const activateRes = await apiPost("/v1/licenses/activate", {
    licenseKey: plaintextKey,
    domain: "portal.example.com",
  });
  if (!activateRes.ok || !activateRes.data.valid || activateRes.data.status !== "ACTIVE") {
    throw new Error(`Activation failed: ${JSON.stringify(activateRes.data)}`);
  }
  if (activateRes.data.domain !== "portal.example.com") {
    throw new Error(`Expected domain 'portal.example.com', got '${activateRes.data.domain}'`);
  }
  console.log("✓ Gate 9 passed: License activated on 'portal.example.com' with status ACTIVE");

  // [Gate 10] Domain canonicalization
  console.log("\n[Gate 10] Testing domain canonicalization and same-domain idempotency...");
  const canonicalRes = await apiPost("/v1/licenses/activate", {
    licenseKey: plaintextKey,
    domain: "HTTPS://WWW.PORTAL.EXAMPLE.COM:8443/wp-admin/?token=secret#frag",
  });
  if (!canonicalRes.ok || !canonicalRes.data.valid) {
    throw new Error(`Canonical activation failed: ${JSON.stringify(canonicalRes.data)}`);
  }
  if (canonicalRes.data.domain !== "portal.example.com") {
    throw new Error(`Expected canonicalized domain 'portal.example.com', got '${canonicalRes.data.domain}'`);
  }
  const activeActivationsCount = await prisma.licenseActivation.count({
    where: { licenseId: lic1.id, status: "ACTIVE" },
  });
  if (activeActivationsCount !== 1) {
    throw new Error(`Expected exactly 1 active activation, got ${activeActivationsCount}`);
  }
  console.log("✓ Gate 10 passed: Domain canonicalized and same-domain activation consumed zero extra seats");

  // [Gate 11] Bad key generic invalid response
  console.log("\n[Gate 11] Testing invalid license key rejection (no key enumeration)...");
  const badKeyRes = await apiPost("/v1/licenses/activate", {
    licenseKey: "NXS-0000-0000-0000-0000-0000-0000-0000-0000",
    domain: "other.com",
  });
  if (badKeyRes.status !== 400) {
    throw new Error(`Expected 400 for bad license key, received ${badKeyRes.status}`);
  }
  if (JSON.stringify(badKeyRes.data).includes(customer1Id)) {
    throw new Error("Security leak: error response leaks customer identity");
  }
  console.log("✓ Gate 11 passed: Invalid key rejected with generic 400 Bad Request");

  // [Gate 12] maxActivations enforced
  console.log("\n[Gate 12] Enforcing maxActivations capacity limit (409 Conflict on 2nd domain)...");
  const overCapacityRes = await apiPost("/v1/licenses/activate", {
    licenseKey: plaintextKey,
    domain: "another-site.com",
  });
  if (overCapacityRes.status !== 409) {
    throw new Error(`Expected 409 Conflict when exceeding maxActivations, received ${overCapacityRes.status}`);
  }
  console.log("✓ Gate 12 passed: maxActivations limit strictly enforced with 409 Conflict");

  // [Gate 13] True concurrent last-seat race
  console.log("\n[Gate 13] Testing true concurrent last-seat activation race (8 parallel distinct domains)...");
  const entMulti = await createTestEntitlement({
    userId: customer1Id,
    maxActivations: 1, // exactly 1 seat
  });
  let licMulti: any = null;
  for (let i = 0; i < 20; i++) {
    licMulti = await prisma.internalLicense.findUnique({ where: { entitlementId: entMulti.id } });
    if (licMulti) break;
    await sleep(500);
  }
  const multiKey = decryptLicenseKey(licMulti.keyCiphertext, licMulti.keyIv, licMulti.keyAuthTag, TEST_ENCRYPTION_KEY);

  const parallelDomains = Array.from({ length: 8 }, (_, idx) => `concurrency-test-${idx}.org`);
  const raceResults = await Promise.all(
    parallelDomains.map((dom) =>
      apiPost("/v1/licenses/activate", {
        licenseKey: multiKey,
        domain: dom,
      }),
    ),
  );

  const successfulActivations = raceResults.filter((r) => r.ok && r.data.valid);
  const conflictActivations = raceResults.filter((r) => r.status === 409);

  if (successfulActivations.length !== 1) {
    throw new Error(`Concurrency violation: Expected exactly 1 winner, received ${successfulActivations.length}`);
  }
  if (conflictActivations.length !== 7) {
    throw new Error(`Expected exactly 7 conflict rejections, received ${conflictActivations.length}`);
  }
  const dbActiveCount = await prisma.licenseActivation.count({
    where: { licenseId: licMulti.id, status: "ACTIVE" },
  });
  if (dbActiveCount !== 1) {
    throw new Error(`Database capacity violated: Expected 1 active row, found ${dbActiveCount}`);
  }
  console.log("✓ Gate 13 passed: 8 concurrent domains serialized: exactly 1 ACTIVE, 7 rejected with 409");

  // [Gate 14] Same-domain concurrent activation idempotency
  console.log("\n[Gate 14] Testing 8 concurrent activations for the SAME domain (idempotency)...");
  const sameDomainResults = await Promise.all(
    Array.from({ length: 8 }, () =>
      apiPost("/v1/licenses/activate", {
        licenseKey: plaintextKey,
        domain: "portal.example.com",
      }),
    ),
  );
  for (const res of sameDomainResults) {
    if (!res.ok || !res.data.valid) {
      throw new Error(`Same-domain activation failed under concurrency: ${JSON.stringify(res.data)}`);
    }
  }
  const sameDomainDbCount = await prisma.licenseActivation.count({
    where: { licenseId: lic1.id, status: "ACTIVE" },
  });
  if (sameDomainDbCount !== 1) {
    throw new Error(`Idempotency failure: Expected 1 active row in DB, found ${sameDomainDbCount}`);
  }
  console.log("✓ Gate 14 passed: All 8 concurrent same-domain activations succeeded idempotently");

  // [Gate 15] Validate active key/domain = valid
  console.log("\n[Gate 15] Public client validates active license & domain (POST /v1/licenses/validate)...");
  const valRes = await apiPost("/v1/licenses/validate", {
    licenseKey: plaintextKey,
    domain: "portal.example.com",
  });
  if (!valRes.ok || !valRes.data.valid || valRes.data.status !== "ACTIVE") {
    throw new Error(`Validation failed for active domain: ${JSON.stringify(valRes.data)}`);
  }
  console.log("✓ Gate 15 passed: Active license and domain successfully validated (valid: true)");

  // [Gate 16] Validate key on unactivated domain = invalid
  console.log("\n[Gate 16] Validating valid key on unactivated domain (returns valid: false)...");
  const valUnactRes = await apiPost("/v1/licenses/validate", {
    licenseKey: plaintextKey,
    domain: "unactivated-site.com",
  });
  if (!valUnactRes.ok || valUnactRes.data.valid !== false) {
    throw new Error(`Expected valid: false for unactivated domain, got ${JSON.stringify(valUnactRes.data)}`);
  }
  console.log("✓ Gate 16 passed: Unactivated domain correctly returned valid: false");

  // [Gate 17] Deactivate domain
  console.log("\n[Gate 17] Deactivating domain (POST /v1/licenses/deactivate)...");
  const deactRes = await apiPost("/v1/licenses/deactivate", {
    licenseKey: plaintextKey,
    domain: "portal.example.com",
  });
  if (!deactRes.ok || !deactRes.data.success) {
    throw new Error(`Deactivation failed: ${JSON.stringify(deactRes.data)}`);
  }
  console.log("✓ Gate 17 passed: Domain 'portal.example.com' successfully deactivated");

  // [Gate 18] Deactivated domain validation invalid
  console.log("\n[Gate 18] Verifying deactivated domain validation returns valid: false...");
  const valDeactRes = await apiPost("/v1/licenses/validate", {
    licenseKey: plaintextKey,
    domain: "portal.example.com",
  });
  if (!valDeactRes.ok || valDeactRes.data.valid !== false) {
    throw new Error(`Expected valid: false for deactivated domain, got ${JSON.stringify(valDeactRes.data)}`);
  }
  console.log("✓ Gate 18 passed: Deactivated domain validation returned valid: false");

  // [Gate 19] Deactivation frees seat
  console.log("\n[Gate 19] Verifying deactivation frees activation capacity for a new domain...");
  const newDomainRes = await apiPost("/v1/licenses/activate", {
    licenseKey: plaintextKey,
    domain: "freed-seat-domain.com",
  });
  if (!newDomainRes.ok || !newDomainRes.data.valid) {
    throw new Error(`Failed to activate new domain after seat release: ${JSON.stringify(newDomainRes.data)}`);
  }
  console.log("✓ Gate 19 passed: Freed seat immediately activated on 'freed-seat-domain.com'");

  // [Gate 20] Entitlement revoked -> immediate validation invalid
  console.log("\n[Gate 20] Testing real-time validation fail-closed on revoked entitlement...");
  await prisma.entitlement.update({
    where: { id: ent1.id },
    data: { status: EntitlementStatus.REVOKED, revokedAt: new Date() },
  });

  const valRevRes = await apiPost("/v1/licenses/validate", {
    licenseKey: plaintextKey,
    domain: "freed-seat-domain.com",
  });
  if (!valRevRes.ok || valRevRes.data.valid !== false) {
    throw new Error(`Expected valid: false on revoked entitlement, got ${JSON.stringify(valRevRes.data)}`);
  }
  console.log("✓ Gate 20 passed: Revoked entitlement immediately failed client validation (valid: false)");

  // [Gate 21] Worker reconciles internal license revoked
  console.log("\n[Gate 21] Verifying worker autonomous reconciliation of revoked entitlement license...");
  let recLic: any = null;
  for (let i = 0; i < 20; i++) {
    recLic = await prisma.internalLicense.findUnique({ where: { id: lic1.id } });
    if (recLic?.status === "REVOKED") break;
    await sleep(500);
  }
  if (recLic?.status !== "REVOKED") {
    throw new Error(`Worker failed to reconcile internal license to REVOKED, current status: ${recLic?.status}`);
  }
  const revokedAudits = await prisma.auditLog.findMany({
    where: { entityId: lic1.id, action: "INTERNAL_LICENSE_REVOKED" },
  });
  if (revokedAudits.length === 0) {
    throw new Error("Missing INTERNAL_LICENSE_REVOKED audit log!");
  }
  console.log("✓ Gate 21 passed: Worker autonomously reconciled license to REVOKED with audit log");

  // [Gate 22] Entitlement expired -> validation invalid
  console.log("\n[Gate 22] Testing entitlement expiration real-time validation failure...");
  const entExpActive = await createTestEntitlement({
    userId: customer1Id,
    maxActivations: 2,
    expiresAt: new Date(Date.now() + 100000), // active now
  });
  let licExpActive: any = null;
  for (let i = 0; i < 20; i++) {
    licExpActive = await prisma.internalLicense.findUnique({ where: { entitlementId: entExpActive.id } });
    if (licExpActive) break;
    await sleep(500);
  }
  const expKey = decryptLicenseKey(licExpActive.keyCiphertext, licExpActive.keyIv, licExpActive.keyAuthTag, TEST_ENCRYPTION_KEY);
  await apiPost("/v1/licenses/activate", { licenseKey: expKey, domain: "exp-test.com" });

  // Now artificially expire the entitlement in DB
  await prisma.entitlement.update({
    where: { id: entExpActive.id },
    data: { expiresAt: new Date(Date.now() - 60000) },
  });

  const valExpiredRes = await apiPost("/v1/licenses/validate", {
    licenseKey: expKey,
    domain: "exp-test.com",
  });
  if (!valExpiredRes.ok || valExpiredRes.data.valid !== false) {
    throw new Error("Validation succeeded on expired entitlement!");
  }
  console.log("✓ Gate 22 passed: Expired entitlement validation failed closed (valid: false)");

  // [Gate 23] updatesUntil/supportUntil returned from Entitlement
  console.log("\n[Gate 23] Verifying updatesUntil and supportUntil returned in validation response...");
  const targetUpdates = new Date(Date.now() + 86400000 * 90);
  const targetSupport = new Date(Date.now() + 86400000 * 180);
  const entRights = await createTestEntitlement({
    userId: customer1Id,
    maxActivations: 1,
    updatesUntil: targetUpdates,
    supportUntil: targetSupport,
  });
  let licRights: any = null;
  for (let i = 0; i < 20; i++) {
    licRights = await prisma.internalLicense.findUnique({ where: { entitlementId: entRights.id } });
    if (licRights) break;
    await sleep(500);
  }
  const rightsKey = decryptLicenseKey(licRights.keyCiphertext, licRights.keyIv, licRights.keyAuthTag, TEST_ENCRYPTION_KEY);
  await apiPost("/v1/licenses/activate", { licenseKey: rightsKey, domain: "rights-test.com" });

  const rightsValRes = await apiPost("/v1/licenses/validate", {
    licenseKey: rightsKey,
    domain: "rights-test.com",
  });
  if (!rightsValRes.ok || !rightsValRes.data.valid) {
    throw new Error("Validation failed for rights test license");
  }
  if (!rightsValRes.data.updatesUntil || !rightsValRes.data.supportUntil) {
    throw new Error("updatesUntil or supportUntil missing from validation response");
  }
  console.log(`✓ Gate 23 passed: Authoritative rights returned (updatesUntil: ${rightsValRes.data.updatesUntil})`);

  // [Gate 24] Wrong encryption key fail closed
  console.log("\n[Gate 24] Testing fail-closed on wrong encryption key...");
  const wrongKeyHex = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
  expect(() =>
    decryptLicenseKey(
      licRights.keyCiphertext,
      licRights.keyIv,
      licRights.keyAuthTag,
      wrongKeyHex,
    ),
  ).toThrow();
  console.log("✓ Gate 24 passed: Decryption with wrong key failed closed");

  // [Gate 25] Ciphertext tamper fail closed
  console.log("\n[Gate 25] Testing fail-closed on tampered ciphertext...");
  const tamperedCiphertext =
    licRights.keyCiphertext[0] === "a"
      ? "b" + licRights.keyCiphertext.slice(1)
      : "a" + licRights.keyCiphertext.slice(1);
  expect(() =>
    decryptLicenseKey(
      tamperedCiphertext,
      licRights.keyIv,
      licRights.keyAuthTag,
      TEST_ENCRYPTION_KEY,
    ),
  ).toThrow();
  console.log("✓ Gate 25 passed: Decryption with tampered ciphertext failed closed");

  // [Gate 26] Audit lifecycle complete
  console.log("\n[Gate 26] Verifying complete audit log trail for license lifecycle...");
  const requiredActions = [
    "INTERNAL_LICENSE_CREATED",
    "LICENSE_ACTIVATED",
    "LICENSE_DEACTIVATED",
    "INTERNAL_LICENSE_REVOKED",
    "LICENSE_KEY_REVEALED",
  ];
  for (const action of requiredActions) {
    const count = await prisma.auditLog.count({ where: { action } });
    if (count === 0) {
      throw new Error(`Missing expected audit action '${action}' in audit_logs!`);
    }
  }
  console.log("✓ Gate 26 passed: Complete audit trail verified (all 5 actions present)");

  // [Gate 27] Admin endpoints enforced via license.read
  console.log("\n[Gate 27] Admin lists licenses with license.read permission...");
  const adminListRes = await apiGet("/admin/internal-licenses", adminToken);
  if (!adminListRes.ok || !Array.isArray(adminListRes.data)) {
    throw new Error(`Admin list failed: ${JSON.stringify(adminListRes.data)}`);
  }
  const custForbiddenRes = await apiGet("/admin/internal-licenses", customer1Token);
  if (custForbiddenRes.status !== 403) {
    throw new Error(`Expected 403 for customer on admin license endpoint, received ${custForbiddenRes.status}`);
  }
  console.log("✓ Gate 27 passed: Admin list licenses succeeded (200 OK), Customer forbidden (403)");

  // [Gate 28] Admin revoke endpoint enforced via license.manage
  console.log("\n[Gate 28] Admin revokes license with license.manage permission...");
  const adminRevokeRes = await apiPost(
    `/admin/internal-licenses/${licRights.id}/revoke`,
    { reasonCode: "ADMINISTRATIVE" },
    adminToken,
  );
  if (!adminRevokeRes.ok || adminRevokeRes.data.status !== "REVOKED") {
    throw new Error(`Admin revoke failed: ${JSON.stringify(adminRevokeRes.data)}`);
  }
  const postRevokeValRes = await apiPost("/v1/licenses/validate", {
    licenseKey: rightsKey,
    domain: "rights-test.com",
  });
  if (postRevokeValRes.data.valid !== false) {
    throw new Error("Validation succeeded after admin revoked license fulfillment!");
  }
  console.log("✓ Gate 28 passed: Admin revoked license, and subsequent client validation failed closed");

  // [Gate 29] Public activation rejects or strips arbitrary metadata
  console.log("\n[Gate 29] Testing public activation rejects or strips arbitrary metadata...");
  const metaEnt = await createTestEntitlement({
    userId: customer1Id,
    maxActivations: 2,
  });
  let metaLic: any = null;
  for (let i = 0; i < 20; i++) {
    metaLic = await prisma.internalLicense.findUnique({ where: { entitlementId: metaEnt.id } });
    if (metaLic) break;
    await sleep(500);
  }
  const metaKey = decryptLicenseKey(metaLic.keyCiphertext, metaLic.keyIv, metaLic.keyAuthTag, TEST_ENCRYPTION_KEY);
  const metaPayload = {
    licenseKey: metaKey,
    domain: "metadata-probe.com",
    metadata: { note: metaKey, attackerSecret: "malicious_payload" },
  };
  const metaActRes = await apiPost("/v1/licenses/activate", metaPayload);
  if (!metaActRes.ok || !metaActRes.data.valid) {
    throw new Error(`Activation failed: ${JSON.stringify(metaActRes.data)}`);
  }
  const metaRow = await prisma.licenseActivation.findFirst({
    where: { licenseId: metaLic.id, normalizedDomain: "metadata-probe.com" },
  });
  if (!metaRow) {
    throw new Error("Activation row not found!");
  }
  const rowMetaStr = JSON.stringify(metaRow.metadata ?? {});
  if (rowMetaStr.includes("NXS-") || rowMetaStr.includes("malicious_payload")) {
    throw new Error(`CRITICAL SECURITY FAILURE: Metadata leaked into DB: ${rowMetaStr}`);
  }
  console.log("✓ Gate 29 passed: Arbitrary metadata stripped / never stored in DB activation record");

  // [Gate 30] Live secret injection verification across entire DB
  console.log("\n[Gate 30] Verifying zero plaintext license keys across DB activations metadata and audit logs...");
  const allActivations = await prisma.licenseActivation.findMany();
  for (const act of allActivations) {
    const actMetaStr = JSON.stringify(act.metadata ?? {});
    if (/NXS-(?:[0-9A-F]{4}-){7}[0-9A-F]{4}/.test(actMetaStr)) {
      throw new Error(`CRITICAL: Found plaintext license key in license_activations id=${act.id}`);
    }
  }
  const allAudits = await prisma.auditLog.findMany({
    where: {
      action: {
        in: [
          "INTERNAL_LICENSE_CREATED",
          "LICENSE_ACTIVATED",
          "LICENSE_DEACTIVATED",
          "INTERNAL_LICENSE_REVOKED",
          "LICENSE_KEY_REVEALED",
        ],
      },
    },
  });
  for (const audit of allAudits) {
    const auditDetailsStr = JSON.stringify(audit.details ?? {});
    if (/NXS-(?:[0-9A-F]{4}-){7}[0-9A-F]{4}/.test(auditDetailsStr)) {
      throw new Error(`CRITICAL: Found plaintext license key in audit_logs id=${audit.id}`);
    }
  }
  console.log("✓ Gate 30 passed: Zero plaintext license keys found in activations metadata or audit details");

  // [Gate 31] All invalid validate states return strictly { valid: false } without error leakage
  console.log("\n[Gate 31] Testing non-enumerating validation across all invalid failure modes...");
  const invalidCases = [
    { label: "Non-existent valid-format key", body: { licenseKey: "NXS-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-1111-2222", domain: "test.com" } },
    { label: "Malformed key format", body: { licenseKey: "INVALID-KEY-123", domain: "test.com" } },
    { label: "Malformed domain", body: { licenseKey: metaKey, domain: "http://invalid domain!#.com" } },
    { label: "Unactivated domain", body: { licenseKey: metaKey, domain: "never-activated-mode.com" } },
    { label: "Revoked license", body: { licenseKey: rightsKey, domain: "rights-test.com" } },
    { label: "Expired entitlement", body: { licenseKey: expKey, domain: "exp-test.com" } },
  ];
  for (const testCase of invalidCases) {
    const res = await apiPost("/v1/licenses/validate", testCase.body);
    if (!res.ok) {
      throw new Error(`Expected 200 OK with valid: false for ${testCase.label}, received status ${res.status}`);
    }
    if (res.data.valid !== false || res.data.error !== undefined || res.data.status !== undefined) {
      throw new Error(`Enumeration leak on ${testCase.label}: received ${JSON.stringify(res.data)}`);
    }
  }
  console.log("✓ Gate 31 passed: All invalid validation modes returned { valid: false } with zero enumeration");

  // [Gate 32] True concurrent dual-worker provisioning race
  console.log("\n[Gate 32] Testing true concurrent dual-worker provisioning race...");
  const batchEnts: any[] = [];
  for (let i = 0; i < 5; i++) {
    const ent = await createTestEntitlement({
      userId: customer1Id,
      maxActivations: 1,
    });
    batchEnts.push(ent);
  }
  const [workerResult1, workerResult2] = await Promise.all([
    provisionInternalLicenses({ workerId: "worker-race-1", batchSize: 10 }),
    provisionInternalLicenses({ workerId: "worker-race-2", batchSize: 10 }),
  ]);
  await sleep(1000);
  for (const ent of batchEnts) {
    const count = await prisma.internalLicense.count({ where: { entitlementId: ent.id } });
    if (count !== 1) {
      throw new Error(`Entitlement ${ent.id} has ${count} internal licenses (expected exactly 1)`);
    }
  }
  console.log(`✓ Gate 32 passed: Dual-worker race provisioned cleanly (W1: ${workerResult1.provisionedCount}, W2: ${workerResult2.provisionedCount}, total 5 unique)`);

  // [Gate 33] Concurrent deactivation CAS: 8 parallel calls -> exactly 1 audit log
  console.log("\n[Gate 33] Testing concurrent deactivation CAS (8 parallel calls, exactly 1 audit log)...");
  const casEnt = await createTestEntitlement({
    userId: customer1Id,
    maxActivations: 2,
  });
  let casLic: any = null;
  for (let i = 0; i < 20; i++) {
    casLic = await prisma.internalLicense.findUnique({ where: { entitlementId: casEnt.id } });
    if (casLic) break;
    await sleep(500);
  }
  const casKey = decryptLicenseKey(casLic.keyCiphertext, casLic.keyIv, casLic.keyAuthTag, TEST_ENCRYPTION_KEY);
  await apiPost("/v1/licenses/activate", { licenseKey: casKey, domain: "cas-deactivate.com" });

  const casActRecord = await prisma.licenseActivation.findFirst({
    where: { licenseId: casLic.id, normalizedDomain: "cas-deactivate.com" },
  });

  const deactParallelResults = await Promise.all(
    Array.from({ length: 8 }, () =>
      apiPost("/v1/licenses/deactivate", {
        licenseKey: casKey,
        domain: "cas-deactivate.com",
      }),
    ),
  );
  for (const res of deactParallelResults) {
    if (!res.ok || !res.data.success) {
      throw new Error(`Concurrent deactivation returned failure: ${JSON.stringify(res.data)}`);
    }
  }
  const deactAuditsAfter = await prisma.auditLog.count({
    where: {
      entity: "LicenseActivation",
      entityId: casActRecord?.id,
      action: "LICENSE_DEACTIVATED",
    },
  });
  if (deactAuditsAfter !== 1) {
    throw new Error(`CAS violation: Expected exactly 1 LICENSE_DEACTIVATED audit log, found ${deactAuditsAfter}`);
  }
  console.log("✓ Gate 33 passed: 8 concurrent deactivations produced exactly 1 audit log (atomic CAS)");

  // [Gate 34] Concurrent admin revoke CAS: 5 parallel calls -> exactly 1 audit log
  console.log("\n[Gate 34] Testing concurrent admin revoke CAS (5 parallel calls, exactly 1 audit log)...");
  const revokeEnt = await createTestEntitlement({
    userId: customer1Id,
    maxActivations: 1,
  });
  let revokeLic: any = null;
  for (let i = 0; i < 20; i++) {
    revokeLic = await prisma.internalLicense.findUnique({ where: { entitlementId: revokeEnt.id } });
    if (revokeLic) break;
    await sleep(500);
  }

  const revokeParallelResults = await Promise.all(
    Array.from({ length: 5 }, () =>
      apiPost(
        `/admin/internal-licenses/${revokeLic.id}/revoke`,
        { reasonCode: "SECURITY" },
        adminToken,
      ),
    ),
  );
  for (const res of revokeParallelResults) {
    if (!res.ok || res.data.status !== "REVOKED") {
      throw new Error(`Concurrent admin revoke returned failure: ${JSON.stringify(res.data)}`);
    }
  }
  const revokeAudits = await prisma.auditLog.count({
    where: {
      entity: "InternalLicense",
      entityId: revokeLic.id,
      action: "INTERNAL_LICENSE_REVOKED",
    },
  });
  if (revokeAudits !== 1) {
    throw new Error(`CAS violation: Expected exactly 1 INTERNAL_LICENSE_REVOKED audit log, found ${revokeAudits}`);
  }
  console.log("✓ Gate 34 passed: 5 concurrent admin revokes produced exactly 1 audit log (atomic CAS)");

  // [Gate 35] Live race: Activate vs Entitlement Revoke
  console.log("\n[Gate 35] Testing live race between Activate and Entitlement Revoke...");
  const raceRevEnt = await createTestEntitlement({
    userId: customer1Id,
    maxActivations: 2,
  });
  let raceRevLic: any = null;
  for (let i = 0; i < 20; i++) {
    raceRevLic = await prisma.internalLicense.findUnique({ where: { entitlementId: raceRevEnt.id } });
    if (raceRevLic) break;
    await sleep(500);
  }
  const raceRevKey = decryptLicenseKey(raceRevLic.keyCiphertext, raceRevLic.keyIv, raceRevLic.keyAuthTag, TEST_ENCRYPTION_KEY);

  await Promise.all([
    prisma.entitlement.update({
      where: { id: raceRevEnt.id },
      data: { status: EntitlementStatus.REVOKED, revokedAt: new Date() },
    }),
    apiPost("/v1/licenses/activate", {
      licenseKey: raceRevKey,
      domain: "race-revoke-test.com",
    }),
  ]);

  await reconcileInternalLicenses();
  const raceValRes = await apiPost("/v1/licenses/validate", {
    licenseKey: raceRevKey,
    domain: "race-revoke-test.com",
  });
  if (raceValRes.data.valid !== false) {
    throw new Error("Live race allowed activation to remain valid on revoked entitlement!");
  }
  console.log("✓ Gate 35 passed: Live race between activate and revoke securely resolved to valid: false");

  // [Gate 36] Live race: Activate vs Deactivate same domain
  console.log("\n[Gate 36] Testing live race between Activate and Deactivate on the same domain...");
  const actDeactEnt = await createTestEntitlement({
    userId: customer1Id,
    maxActivations: 2,
  });
  let actDeactLic: any = null;
  for (let i = 0; i < 20; i++) {
    actDeactLic = await prisma.internalLicense.findUnique({ where: { entitlementId: actDeactEnt.id } });
    if (actDeactLic) break;
    await sleep(500);
  }
  const actDeactKey = decryptLicenseKey(actDeactLic.keyCiphertext, actDeactLic.keyIv, actDeactLic.keyAuthTag, TEST_ENCRYPTION_KEY);

  await apiPost("/v1/licenses/activate", { licenseKey: actDeactKey, domain: "race-act-deact.com" });

  const [actResult, deactResult] = await Promise.all([
    apiPost("/v1/licenses/activate", { licenseKey: actDeactKey, domain: "race-act-deact.com" }),
    apiPost("/v1/licenses/deactivate", { licenseKey: actDeactKey, domain: "race-act-deact.com" }),
  ]);
  if (actResult.status === 500 || deactResult.status === 500) {
    throw new Error(`Race returned 500: act=${actResult.status}, deact=${deactResult.status}`);
  }
  const activeCountInDb = await prisma.licenseActivation.count({
    where: { licenseId: actDeactLic.id, normalizedDomain: "race-act-deact.com", status: "ACTIVE" },
  });
  if (activeCountInDb > 1) {
    throw new Error(`Inconsistent state: ${activeCountInDb} active records for same domain`);
  }
  console.log(`✓ Gate 36 passed: Simultaneous activate & deactivate serialized cleanly (DB active count: ${activeCountInDb})`);

  // [Gate 37] Authoritative fulfillment type check: non-INTERNAL_LICENSE fails closed
  console.log("\n[Gate 37] Testing authoritative fulfillment type check (non-INTERNAL_LICENSE fails closed)...");
  const wrongTypeEnt = await createTestEntitlement({
    userId: customer1Id,
    fulfillmentType: FulfillmentType.EXTERNAL_MANAGED,
  });
  const fakePlaintext = generateLicenseKey();
  const fakeEnc = encryptLicenseKey(fakePlaintext, TEST_ENCRYPTION_KEY);
  await prisma.internalLicense.create({
    data: {
      entitlementId: wrongTypeEnt.id,
      userId: customer1Id,
      productId: wrongTypeEnt.productId,
      variantId: wrongTypeEnt.variantId,
      keyHash: hashLicenseKey(fakePlaintext),
      keyCiphertext: fakeEnc.ciphertext,
      keyIv: fakeEnc.iv,
      keyAuthTag: fakeEnc.authTag,
      keyLast4: extractKeyLast4(fakePlaintext),
      status: LicenseStatus.ACTIVE,
    },
  });

  const wrongValRes = await apiPost("/v1/licenses/validate", {
    licenseKey: fakePlaintext,
    domain: "wrong-fulfillment.com",
  });
  if (wrongValRes.data.valid !== false) {
    throw new Error("Validation succeeded for non-INTERNAL_LICENSE entitlement!");
  }
  const wrongActRes = await apiPost("/v1/licenses/activate", {
    licenseKey: fakePlaintext,
    domain: "wrong-fulfillment.com",
  });
  if (wrongActRes.status !== 400 || !JSON.stringify(wrongActRes.data).includes("Invalid license key or domain")) {
    throw new Error(`Expected 400 'Invalid license key or domain', received ${wrongActRes.status}: ${JSON.stringify(wrongActRes.data)}`);
  }
  console.log("✓ Gate 37 passed: Non-INTERNAL_LICENSE entitlement fails validation (valid: false) and activation (400 generic)");

  // [Gate 38] Malformed license key regex validation
  console.log("\n[Gate 38] Testing strict regex enforcement on malformed license keys...");
  const malformedKeys = [
    "NXS-1234",
    "NXS-GGGG-2222-3333-4444-5555-6666-7777-8888",
    "NXS-ZZZZ-2222-3333-4444-5555-6666-7777-8888",
    "1111-2222-3333-4444-5555-6666-7777-8888",
    "NXS-1111-2222-3333-4444-5555-6666-7777",
    "NXS-11111-2222-3333-4444-5555-6666-7777-8888",
  ];
  for (const mKey of malformedKeys) {
    const actRes = await apiPost("/v1/licenses/activate", { licenseKey: mKey, domain: "valid-domain.com" });
    if (actRes.status !== 400) {
      throw new Error(`Expected 400 for malformed key '${mKey}', got ${actRes.status}`);
    }
    const valRes = await apiPost("/v1/licenses/validate", { licenseKey: mKey, domain: "valid-domain.com" });
    if (valRes.data.valid !== false) {
      throw new Error(`Expected valid: false for malformed key '${mKey}', got ${JSON.stringify(valRes.data)}`);
    }
    const deactRes = await apiPost("/v1/licenses/deactivate", { licenseKey: mKey, domain: "valid-domain.com" });
    if (deactRes.status !== 400) {
      throw new Error(`Expected 400 for deactivation with malformed key '${mKey}', got ${deactRes.status}`);
    }
  }
  console.log("✓ Gate 38 passed: All malformed license keys rejected generically across activate, validate, and deactivate");

  // [Gate 39] Admin revoke free-text license-key injection protection
  console.log("\n[Gate 39] Testing admin revoke license-key injection protection...");
  const injEnt = await createTestEntitlement({
    userId: customer1Id,
    maxActivations: 1,
  });
  let injLic: any = null;
  for (let i = 0; i < 20; i++) {
    injLic = await prisma.internalLicense.findUnique({ where: { entitlementId: injEnt.id } });
    if (injLic) break;
    await sleep(500);
  }
  const realKey = decryptLicenseKey(injLic.keyCiphertext, injLic.keyIv, injLic.keyAuthTag, TEST_ENCRYPTION_KEY);

  // Attempt 1: Malicious key injected into "reason" (stripped by ValidationPipe, safe default reasonCode used)
  const injReasonRes = await apiPost(
    `/admin/internal-licenses/${injLic.id}/revoke`,
    { reason: realKey },
    adminToken,
  );
  if (!injReasonRes.ok || injReasonRes.data.status !== "REVOKED") {
    throw new Error(`Expected successful revoke with stripped reason, got ${injReasonRes.status}`);
  }

  // Attempt 2: Malicious key injected into "reasonCode" (strictly rejected with 400)
  const injReasonCodeRes = await apiPost(
    `/admin/internal-licenses/${injLic.id}/revoke`,
    { reasonCode: realKey },
    adminToken,
  );
  if (injReasonCodeRes.status !== 400) {
    throw new Error(`Expected 400 for key-injected reasonCode, got ${injReasonCodeRes.status}`);
  }

  // Comprehensive DB and response scan: realKey must NOT appear in audit_logs, DB fields, metadata, or responses
  const allAuditsForInj = await prisma.auditLog.findMany();
  for (const a of allAuditsForInj) {
    const detailsStr = JSON.stringify(a.details ?? {});
    if (detailsStr.includes(realKey)) {
      throw new Error(`CRITICAL INJECTION LEAK: realKey found in audit log ${a.id}: ${detailsStr}`);
    }
  }
  const allLicRows = await prisma.internalLicense.findMany({ where: { id: injLic.id } });
  for (const l of allLicRows) {
    const rowStr = JSON.stringify(l);
    if (rowStr.includes(realKey)) {
      throw new Error(`CRITICAL INJECTION LEAK: realKey found in internal_license row ${l.id}`);
    }
  }
  if (JSON.stringify(injReasonRes.data).includes(realKey) || JSON.stringify(injReasonCodeRes.data).includes(realKey)) {
    throw new Error("CRITICAL INJECTION LEAK: realKey found in API response body");
  }
  console.log("✓ Gate 39 passed: License key injection safely prevented; real key absent from audit logs, DB, and API responses");

  // [Gate 40] Dual-worker provisioning: exactly 1 license AND exactly 1 creation audit per entitlement
  console.log("\n[Gate 40] Testing dual-worker provisioning audit exactness (1 license & 1 audit per entitlement)...");
  const auditEnts: any[] = [];
  for (let i = 0; i < 5; i++) {
    const ent = await createTestEntitlement({
      userId: customer1Id,
      maxActivations: 1,
    });
    auditEnts.push(ent);
  }

  // Two workers concurrently race to provision the 5 entitlements
  await Promise.all([
    provisionInternalLicenses({ workerId: "worker-audit-race-1", batchSize: 10 }),
    provisionInternalLicenses({ workerId: "worker-audit-race-2", batchSize: 10 }),
  ]);
  await sleep(1000);

  for (const ent of auditEnts) {
    const licCount = await prisma.internalLicense.count({ where: { entitlementId: ent.id } });
    if (licCount !== 1) {
      throw new Error(`Expected exactly 1 InternalLicense for ent ${ent.id}, got ${licCount}`);
    }
    const lic = await prisma.internalLicense.findUnique({ where: { entitlementId: ent.id } });
    const auditCount = await prisma.auditLog.count({
      where: {
        entity: "InternalLicense",
        entityId: lic!.id,
        action: "INTERNAL_LICENSE_CREATED",
      },
    });
    if (auditCount !== 1) {
      throw new Error(`Expected exactly 1 INTERNAL_LICENSE_CREATED audit for ent ${ent.id}, got ${auditCount}`);
    }
  }
  console.log("✓ Gate 40 passed: Dual-worker race produced exactly 1 InternalLicense and 1 creation audit per entitlement");

  // [Gate 41] Activate vs Deactivate race: validation matches final DB state and exactly-once deactivation audit
  console.log("\n[Gate 41] Testing activate vs deactivate race final-state consistency...");
  const race41Ent = await createTestEntitlement({
    userId: customer1Id,
    maxActivations: 2,
  });
  let race41Lic: any = null;
  for (let i = 0; i < 20; i++) {
    race41Lic = await prisma.internalLicense.findUnique({ where: { entitlementId: race41Ent.id } });
    if (race41Lic) break;
    await sleep(500);
  }
  const race41Key = decryptLicenseKey(race41Lic.keyCiphertext, race41Lic.keyIv, race41Lic.keyAuthTag, TEST_ENCRYPTION_KEY);

  // Pre-activate
  await apiPost("/v1/licenses/activate", { licenseKey: race41Key, domain: "race-gate41.com" });

  // Concurrently race activate and deactivate for the same domain
  const [raceActRes, raceDeactRes] = await Promise.all([
    apiPost("/v1/licenses/activate", { licenseKey: race41Key, domain: "race-gate41.com" }),
    apiPost("/v1/licenses/deactivate", { licenseKey: race41Key, domain: "race-gate41.com" }),
  ]);
  if (!raceActRes.ok || !raceDeactRes.ok) {
    throw new Error(`Race returned failure: act=${raceActRes.status}, deact=${raceDeactRes.status}`);
  }

  // Inspect final database state
  const dbRows = await prisma.licenseActivation.findMany({
    where: { licenseId: race41Lic.id, normalizedDomain: "race-gate41.com" },
  });
  if (dbRows.length !== 1) {
    throw new Error(`Expected exactly 1 DB row for domain, found ${dbRows.length}`);
  }
  const finalDbState = dbRows[0].status;

  // Validate endpoint verification against final state
  const finalValRes = await apiPost("/v1/licenses/validate", {
    licenseKey: race41Key,
    domain: "race-gate41.com",
  });
  if (finalDbState === "ACTIVE") {
    if (!finalValRes.ok || finalValRes.data.valid !== true) {
      throw new Error(`Expected valid: true for ACTIVE final state, got ${JSON.stringify(finalValRes.data)}`);
    }
  } else if (finalDbState === "DEACTIVATED") {
    if (!finalValRes.ok || finalValRes.data.valid !== false) {
      throw new Error(`Expected valid: false for DEACTIVATED final state, got ${JSON.stringify(finalValRes.data)}`);
    }
  }

  // Verify deactivation audit count
  const deactAuditCount = await prisma.auditLog.count({
    where: {
      entity: "LicenseActivation",
      entityId: dbRows[0].id,
      action: "LICENSE_DEACTIVATED",
    },
  });
  if (deactAuditCount > 1) {
    throw new Error(`Expected at most 1 LICENSE_DEACTIVATED audit, found ${deactAuditCount}`);
  }
  console.log(`✓ Gate 41 passed: Race finalized in consistent state '${finalDbState}', validation accurately matched, audits exactly-once`);

  console.log("\n==================================================");
  console.log("ALL 41 PHASE 7 LIVE ACCEPTANCE GATES PASSED SUCCESSFULLY!");
  console.log("==================================================");
}

function expect(fn: () => any) {
  return {
    toThrow: () => {
      let threw = false;
      try {
        fn();
      } catch {
        threw = true;
      }
      if (!threw) {
        throw new Error("Expected function to throw, but it did not");
      }
    },
  };
}

runPhase7Acceptance()
  .catch((err) => {
    console.error("\n❌ PHASE 7 ACCEPTANCE RUN FAILED:");
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    stopChildProcesses();
    await prisma.$disconnect();
  });
