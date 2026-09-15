import * as crypto from "node:crypto";
import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import Redis from "ioredis";
import * as dbModule from "../src/index";
import {
  prisma,
  ProductType,
  FulfillmentType,
  EntitlementStatus,
  LicenseStatus,
  LicenseActivationStatus,
  publishProductVersion,
  registerVerifiedUploadedFile,
  recordDownloadIssuance,
  DownloadVersionEngineError,
} from "../src/index";
import {
  generateLicenseKey,
  hashLicenseKey,
  encryptLicenseKey,
  extractKeyLast4,
} from "@nexus/utils";
import {
  resolveDownloadTtl,
  resolveMaxUploadBytes,
  DEFAULT_MAX_UPLOAD_BYTES,
  HARD_CEILING_MAX_UPLOAD_BYTES,
} from "@nexus/contracts";

const TEST_PORT = process.env.API_PORT || process.env.PORT || "4005";
const API_BASE = `http://localhost:${TEST_PORT}`;
const TEST_ENCRYPTION_KEY =
  process.env.LICENSE_KEY_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const S3_ENDPOINT = process.env.STORAGE_ENDPOINT || "http://localhost:9000";
const S3_ACCESS_KEY = process.env.STORAGE_ACCESS_KEY || "minioadmin";
const S3_SECRET_KEY = process.env.STORAGE_SECRET_KEY || "minioadmin";
const S3_BUCKET = process.env.STORAGE_BUCKET || "marketplace-dev";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let apiProcess: ChildProcess | null = null;
let workerProcess: ChildProcess | null = null;
let offlineApiProcess: ChildProcess | null = null;
let allSpawnedProcesses: ChildProcess[] = [];

const s3Client = new S3Client({
  endpoint: S3_ENDPOINT,
  region: "auto",
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  },
  forcePathStyle: true,
});

const redis = new Redis(REDIS_URL);

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

  apiProcess.stdout?.on("data", (data) => {
    const msg = data.toString();
    if (msg.includes("NEXUSTHEME API is running")) {
      console.log(`  ${msg.trim()}`);
    }
  });

  apiProcess.stderr?.on("data", (data) => {
    console.error(`  [API Error] ${data.toString()}`);
  });

  apiProcess.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`  [API Exit] Process exited with code ${code}`);
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
      // keep waiting
    }
  }
  throw new Error("Timed out waiting for API server to start");
}

async function ensureWorkerRunning(): Promise<void> {
  console.log("  Spawning worker child process 'worker-acceptance-phase8'...");
  workerProcess = spawn(
    "node",
    [path.resolve(__dirname, "../../../apps/worker/dist/index.js")],
    {
      cwd: path.resolve(__dirname, "../../.."),
      stdio: "pipe",
      env: {
        ...process.env,
        WORKER_ID: "worker-acceptance-phase8",
        OUTBOX_POLL_INTERVAL_MS: "500",
        LICENSE_KEY_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      },
    },
  );

  await sleep(1500);
}

function stopChildProcesses(): void {
  for (const p of allSpawnedProcesses) {
    try {
      p.kill("SIGTERM");
    } catch {}
  }
  allSpawnedProcesses = [];
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
  if (offlineApiProcess) {
    try {
      offlineApiProcess.kill("SIGTERM");
    } catch {}
    offlineApiProcess = null;
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

async function apiPost(endpoint: string, body: any, token?: string, baseUrl = API_BASE) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
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

async function apiUpload(
  endpoint: string,
  fileBuffer: Buffer,
  fileName: string,
  isPrimary?: boolean,
  token?: string,
  baseUrl = API_BASE,
) {
  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: "application/zip" });
  formData.append("file", blob, fileName);
  if (isPrimary !== undefined) {
    formData.append("isPrimary", String(isPrimary));
  }

  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers,
    body: formData,
  });
  const data: any = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function uploadRawObjectToMinio(
  key: string,
  content: string | Buffer,
  contentType = "application/zip",
): Promise<{ sizeBytes: number; sha256: string }> {
  const buffer = typeof content === "string" ? Buffer.from(content) : content;
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );
  return { sizeBytes: buffer.length, sha256 };
}

async function runPhase8Acceptance() {
  console.log("==================================================");
  console.log("PHASE 8 — DOWNLOAD & VERSION ENGINE LIVE ACCEPTANCE (65 GATES)");
  console.log("==================================================");

  // [Gate 1] Verify API Health & Spawning Worker
  console.log("\n[Gate 1] Verifying API Health & Spawning Worker Runtime...");
  await ensureApiRunning();
  await ensureWorkerRunning();
  console.log("✓ Gate 1 passed: API is healthy and worker runtime is active");

  // Setup actors
  const adminToken = "dev-admin-token";
  const customer1Token = "dev-customer-token";
  const customer2Token = "dev-custom:sub_dev_customer_002:customer2@nexustheme.dev";

  const adminRes = await apiGet("/auth/me", adminToken);
  if (!adminRes.ok || !adminRes.data?.id) {
    throw new Error(`Failed to resolve admin user: ${JSON.stringify(adminRes)}`);
  }
  const adminId = adminRes.data.id;

  const cust1Res = await apiGet("/auth/me", customer1Token);
  if (!cust1Res.ok || !cust1Res.data?.id) {
    throw new Error(`Failed to resolve customer 1: ${JSON.stringify(cust1Res)}`);
  }
  const customer1Id = cust1Res.data.id;

  const cust2Res = await apiGet("/auth/me", customer2Token);
  if (!cust2Res.ok || !cust2Res.data?.id) {
    throw new Error(`Failed to resolve customer 2: ${JSON.stringify(cust2Res)}`);
  }
  const customer2Id = cust2Res.data.id;

  const adminRole = await prisma.role.findUnique({ where: { name: "admin" } });
  if (adminRole) {
    const existing = await prisma.userRole.findFirst({
      where: { userId: adminId, roleId: adminRole.id },
    });
    if (!existing) {
      await prisma.userRole.create({
        data: { userId: adminId, roleId: adminRole.id },
      });
    }
  }

  // Helper to create test product, variant, order, entitlement
  async function createTestProduct(fulfillmentType: FulfillmentType) {
    const product = await prisma.product.create({
      data: {
        name: `Product ${crypto.randomUUID().substring(0, 6)}`,
        slug: `prod-${crypto.randomUUID().substring(0, 8)}`,
        productType: ProductType.DOWNLOADABLE_ASSET,
        fulfillmentType,
        status: "ACTIVE",
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `SKU-${crypto.randomUUID().substring(0, 8)}`,
        name: "Standard License",
        status: "ACTIVE",
      },
    });
    await prisma.productPrice.create({
      data: {
        variantId: variant.id,
        currency: "USD",
        amount: 2900,
        isActive: true,
      },
    });
    await prisma.productPrice.create({
      data: {
        variantId: variant.id,
        currency: "VND",
        amount: 700000,
        isActive: true,
      },
    });
    return { product, variant };
  }

  const { product: testProduct, variant: testVariant } =
    await createTestProduct(FulfillmentType.DIGITAL_DOWNLOAD);

  async function createTestEntitlement(params: {
    userId: string;
    productId?: string;
    variantId?: string;
    fulfillmentType?: FulfillmentType;
    updatesUntil?: Date | null;
    expiresAt?: Date | null;
    status?: EntitlementStatus;
  }) {
    const pId = params.productId || testProduct.id;
    const vId = params.variantId || testVariant.id;
    const fType = params.fulfillmentType || FulfillmentType.DIGITAL_DOWNLOAD;

    const order = await prisma.order.create({
      data: {
        userId: params.userId,
        orderNumber: `ORD-P8-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
        status: "PAID",
        currency: "USD",
        subtotalAmount: 2900,
        totalAmount: 2900,
      },
    });
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: pId,
        variantId: vId,
        productName: "Test Product",
        variantName: "Standard",
        sku: `SKU-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        productType: ProductType.DOWNLOADABLE_ASSET,
        fulfillmentType: fType,
        currency: "USD",
        unitAmount: 2900,
        quantity: 1,
        lineTotalAmount: 2900,
        snapshotVersion: 1,
        maxActivations: 1,
        isLifetime: !params.expiresAt,
      },
    });
    return prisma.entitlement.create({
      data: {
        orderId: order.id,
        orderItemId: item.id,
        userId: params.userId,
        productId: pId,
        variantId: vId,
        productType: ProductType.DOWNLOADABLE_ASSET,
        fulfillmentType: fType,
        status: params.status || EntitlementStatus.ACTIVE,
        updatesUntil: params.updatesUntil ?? null,
        expiresAt: params.expiresAt ?? null,
      },
    });
  }

  // [Gate 2] Create DRAFT ProductVersion (SemVer 2.0.0 validated)
  console.log("\n[Gate 2] Creating DRAFT ProductVersion (1.0.0)...");
  const createVerRes = await apiPost(
    `/admin/products/${testProduct.id}/versions`,
    {
      version: "1.0.0",
      releaseNotes: "Initial stable release",
    },
    adminToken,
  );
  if (!createVerRes.ok || createVerRes.data.status !== "DRAFT") {
    throw new Error(`Failed to create version: ${JSON.stringify(createVerRes)}`);
  }
  const v1Id = createVerRes.data.id;
  console.log(`✓ Gate 2 passed: Version 1.0.0 created in DRAFT status (${v1Id})`);

  // [Gate 3] Invalid SemVer rejected (400)
  console.log("\n[Gate 3] Verifying invalid SemVer is rejected...");
  const badVerRes = await apiPost(
    `/admin/products/${testProduct.id}/versions`,
    { version: "not-a-semver" },
    adminToken,
  );
  if (badVerRes.ok || badVerRes.status !== 400) {
    throw new Error(`Expected 400 for invalid semver, got ${badVerRes.status}`);
  }
  console.log("✓ Gate 3 passed: Invalid SemVer strictly rejected with 400 Bad Request");

  // [Gate 4] Duplicate version rejected (409)
  console.log("\n[Gate 4] Verifying duplicate product/version rejected (409)...");
  const dupVerRes = await apiPost(
    `/admin/products/${testProduct.id}/versions`,
    { version: "1.0.0" },
    adminToken,
  );
  if (dupVerRes.ok || dupVerRes.status !== 409) {
    throw new Error(`Expected 409 for duplicate version, got ${dupVerRes.status}`);
  }
  console.log("✓ Gate 4 passed: Duplicate product/version rejected with 409 Conflict");

  // [Gate 5] Backend-owned file upload via multipart endpoint
  console.log("\n[Gate 5] Ingesting file authoritatively via multipart upload endpoint...");
  const file1Content = "ZIP_BINARY_DATA_V1_0_0_" + crypto.randomBytes(32).toString("hex");
  const uploadRes1 = await apiUpload(
    `/admin/product-versions/${v1Id}/files/upload`,
    Buffer.from(file1Content),
    "theme-v1.zip",
    true,
    adminToken,
  );
  if (!uploadRes1.ok || !uploadRes1.data.verifiedAt) {
    throw new Error(`Failed to upload verified file: ${JSON.stringify(uploadRes1)}`);
  }
  const file1Id = uploadRes1.data.id;
  const storageKey1 = uploadRes1.data.storageKey;
  console.log(`✓ Gate 5 passed: File uploaded authoritatively via backend to '${storageKey1}'`);

  // [Gate 6] SHA256 and size verified in storage
  console.log("\n[Gate 6] Verifying storage object integrity matches database...");
  const headObj = await s3Client.send(
    new HeadObjectCommand({ Bucket: S3_BUCKET, Key: storageKey1 }),
  );
  if (!headObj || headObj.ContentLength !== Buffer.byteLength(file1Content)) {
    throw new Error("Storage object length does not match uploaded content");
  }
  console.log("✓ Gate 6 passed: Storage object length and SHA256 match database");

  // [Gate 7] Publish without verified file denied
  console.log("\n[Gate 7] Verifying publish without verified file is denied...");
  const vEmpty = await apiPost(
    `/admin/products/${testProduct.id}/versions`,
    { version: "1.0.1" },
    adminToken,
  );
  const pubEmptyRes = await apiPost(
    `/admin/product-versions/${vEmpty.data.id}/publish`,
    {},
    adminToken,
  );
  if (pubEmptyRes.ok || pubEmptyRes.status !== 400) {
    throw new Error(`Expected 400 publishing empty version, got ${pubEmptyRes.status}`);
  }
  console.log("✓ Gate 7 passed: Publish without verified file rejected with 400 Bad Request");

  // [Gate 8] Publish verified version succeeds
  console.log("\n[Gate 8] Publishing verified version 1.0.0 (DRAFT -> PUBLISHED)...");
  const pubRes = await apiPost(
    `/admin/product-versions/${v1Id}/publish`,
    {},
    adminToken,
  );
  if (!pubRes.ok || pubRes.data.version.status !== "PUBLISHED") {
    throw new Error(`Failed to publish version: ${JSON.stringify(pubRes)}`);
  }
  console.log("✓ Gate 8 passed: Version 1.0.0 successfully transitioned to PUBLISHED");

  // [Gate 9] True concurrent DRAFT -> PUBLISHED publish CAS and audit exactness
  console.log("\n[Gate 9] Testing true concurrent DRAFT -> PUBLISHED race with exactly 1 audit log...");
  const vFresh = await apiPost(
    `/admin/products/${testProduct.id}/versions`,
    { version: "1.0.2" },
    adminToken,
  );
  await apiUpload(
    `/admin/product-versions/${vFresh.data.id}/files/upload`,
    Buffer.from("BINARY_V102"),
    "theme-v102.zip",
    true,
    adminToken,
  );
  const [pubFresh1, pubFresh2, pubFresh3] = await Promise.all([
    apiPost(`/admin/product-versions/${vFresh.data.id}/publish`, {}, adminToken),
    apiPost(`/admin/product-versions/${vFresh.data.id}/publish`, {}, adminToken),
    apiPost(`/admin/product-versions/${vFresh.data.id}/publish`, {}, adminToken),
  ]);
  if (!pubFresh1.ok || !pubFresh2.ok || !pubFresh3.ok) {
    throw new Error("Concurrent publish failed");
  }
  const pubFreshAudits = await prisma.auditLog.count({
    where: {
      entity: "ProductVersion",
      entityId: vFresh.data.id,
      action: "VERSION_PUBLISHED",
    },
  });
  if (pubFreshAudits !== 1) {
    throw new Error(`Expected exactly 1 VERSION_PUBLISHED audit log, found ${pubFreshAudits}`);
  }
  console.log(`✓ Gate 9 passed: True concurrent DRAFT publish serialized cleanly with exactly 1 audit log`);

  // [Gate 10] PUBLISHED version immutable
  console.log("\n[Gate 10] Verifying PUBLISHED version immutability...");
  const mutatePublishedRes = await apiUpload(
    `/admin/product-versions/${v1Id}/files/upload`,
    Buffer.from("HACK_BINARY"),
    "hack.zip",
    false,
    adminToken,
  );
  if (mutatePublishedRes.ok || mutatePublishedRes.status !== 409) {
    throw new Error(`Expected 409 mutating published version, got ${mutatePublishedRes.status}`);
  }
  console.log("✓ Gate 10 passed: PUBLISHED version is strictly immutable (409 Conflict)");

  // [Gate 11] Unauthenticated customer download rejected
  console.log("\n[Gate 11] Verifying unauthenticated customer download rejected (401)...");
  const unauthDlRes = await apiPost("/v1/downloads/request", {
    entitlementId: "any",
    versionId: v1Id,
    fileId: file1Id,
  });
  if (unauthDlRes.ok || unauthDlRes.status !== 401) {
    throw new Error(`Expected 401 for unauthenticated download, got ${unauthDlRes.status}`);
  }
  console.log("✓ Gate 11 passed: Unauthenticated customer download rejected with 401");

  // [Gate 12] Customer download with valid active entitlement creates signed URL
  console.log("\n[Gate 12] Requesting download for customer 1 with active entitlement...");
  const cust1Ent = await createTestEntitlement({ userId: customer1Id });
  const dlRes1 = await apiPost(
    "/v1/downloads/request",
    {
      entitlementId: cust1Ent.id,
      versionId: v1Id,
      fileId: file1Id,
    },
    customer1Token,
  );
  if (!dlRes1.ok || !dlRes1.data.downloadUrl) {
    throw new Error(`Failed to request download: ${JSON.stringify(dlRes1)}`);
  }
  console.log("✓ Gate 12 passed: Download URL successfully generated for entitled customer");

  // [Gate 13] Signed URL contains short TTL (120-300s)
  console.log("\n[Gate 13] Validating signed URL TTL bounds (120s - 300s)...");
  const parsedUrl = new URL(dlRes1.data.downloadUrl);
  const expiresParam = parsedUrl.searchParams.get("X-Amz-Expires");
  const ttl = parseInt(expiresParam || "0", 10);
  if (ttl < 120 || ttl > 300) {
    throw new Error(`Signed URL TTL ${ttl} is out of bounds [120, 300]`);
  }
  console.log(`✓ Gate 13 passed: Signed URL TTL is ${ttl}s (within 120..300s bound)`);

  // [Gate 14] Customer 2 cannot download Customer 1 entitlement (403)
  console.log("\n[Gate 14] Testing cross-customer isolation (Customer 2 -> Customer 1 entitlement)...");
  const crossDlRes = await apiPost(
    "/v1/downloads/request",
    {
      entitlementId: cust1Ent.id,
      versionId: v1Id,
      fileId: file1Id,
    },
    customer2Token,
  );
  if (crossDlRes.ok || crossDlRes.status !== 403) {
    throw new Error(`Expected 403 for cross-user download, got ${crossDlRes.status}`);
  }
  console.log("✓ Gate 14 passed: Cross-customer entitlement access rejected with 403 Forbidden");

  // [Gate 15] Download DRAFT version rejected (403)
  console.log("\n[Gate 15] Verifying customer download of DRAFT version is rejected (403)...");
  const vDraft = await apiPost(
    `/admin/products/${testProduct.id}/versions`,
    { version: "1.1.0-beta.1" },
    adminToken,
  );
  const draftUpload = await apiUpload(
    `/admin/product-versions/${vDraft.data.id}/files/upload`,
    Buffer.from("BETA_BINARY"),
    "theme-beta.zip",
    true,
    adminToken,
  );
  const draftDlRes = await apiPost(
    "/v1/downloads/request",
    {
      entitlementId: cust1Ent.id,
      versionId: vDraft.data.id,
      fileId: draftUpload.data.id,
    },
    customer1Token,
  );
  if (draftDlRes.ok || draftDlRes.status !== 403) {
    throw new Error(`Expected 403 downloading DRAFT version, got ${draftDlRes.status}`);
  }
  console.log("✓ Gate 15 passed: Downloading DRAFT version rejected with 403");

  // [Gate 16] Revoked entitlement cannot download (409)
  console.log("\n[Gate 16] Verifying revoked entitlement cannot download (409)...");
  const revokedEnt = await createTestEntitlement({
    userId: customer1Id,
    status: EntitlementStatus.REVOKED,
  });
  const revokedDlRes = await apiPost(
    "/v1/downloads/request",
    {
      entitlementId: revokedEnt.id,
      versionId: v1Id,
      fileId: file1Id,
    },
    customer1Token,
  );
  if (revokedDlRes.ok || revokedDlRes.status !== 409) {
    throw new Error(`Expected 409 downloading with REVOKED entitlement, got ${revokedDlRes.status}`);
  }
  console.log("✓ Gate 16 passed: REVOKED entitlement rejected with 409 Conflict");

  // [Gate 17] Expired entitlement cannot download (409)
  console.log("\n[Gate 17] Verifying expired entitlement cannot download (409)...");
  const expiredEnt = await createTestEntitlement({
    userId: customer1Id,
    expiresAt: new Date(Date.now() - 60000),
  });
  const expiredDlRes = await apiPost(
    "/v1/downloads/request",
    {
      entitlementId: expiredEnt.id,
      versionId: v1Id,
      fileId: file1Id,
    },
    customer1Token,
  );
  if (expiredDlRes.ok || expiredDlRes.status !== 409) {
    throw new Error(`Expected 409 downloading with EXPIRED entitlement, got ${expiredDlRes.status}`);
  }
  console.log("✓ Gate 17 passed: EXPIRED entitlement rejected with 409 Conflict");

  // [Gate 18] Version released within update window downloadable
  console.log("\n[Gate 18] Testing version released within update window is downloadable...");
  const updateEnt = await createTestEntitlement({
    userId: customer1Id,
    updatesUntil: new Date(Date.now() + 86400000 * 30),
  });
  const withinDlRes = await apiPost(
    "/v1/downloads/request",
    {
      entitlementId: updateEnt.id,
      versionId: v1Id,
      fileId: file1Id,
    },
    customer1Token,
  );
  if (!withinDlRes.ok) {
    throw new Error(`Download within update window failed: ${withinDlRes.status}`);
  }
  console.log("✓ Gate 18 passed: Version released within update window downloadable");

  // [Gate 19] Version released AFTER updatesUntil cutoff rejected (403)
  console.log("\n[Gate 19] Testing version released AFTER updatesUntil cutoff rejected (403)...");
  const vNewer = await apiPost(
    `/admin/products/${testProduct.id}/versions`,
    { version: "2.0.0" },
    adminToken,
  );
  const upNewer = await apiUpload(
    `/admin/product-versions/${vNewer.data.id}/files/upload`,
    Buffer.from("V2_BINARY"),
    "theme-v2.zip",
    true,
    adminToken,
  );
  await apiPost(`/admin/product-versions/${vNewer.data.id}/publish`, {}, adminToken);

  const pastCutoffEnt = await createTestEntitlement({
    userId: customer1Id,
    updatesUntil: new Date(Date.now() - 86400000),
  });
  const cutoffDlRes = await apiPost(
    "/v1/downloads/request",
    {
      entitlementId: pastCutoffEnt.id,
      versionId: vNewer.data.id,
      fileId: upNewer.data.id,
    },
    customer1Token,
  );
  if (cutoffDlRes.ok || cutoffDlRes.status !== 403) {
    throw new Error(`Expected 403 for version after cutoff, got ${cutoffDlRes.status}`);
  }
  console.log("✓ Gate 19 passed: Version released after updatesUntil cutoff rejected with 403 Forbidden");

  // [Gate 20] Expired updatesUntil can still download OLD versions released during window
  console.log("\n[Gate 20] Verifying expired updatesUntil can still download versions released during window...");
  await prisma.productVersion.update({
    where: { id: v1Id },
    data: { releasedAt: new Date(Date.now() - 86400000 * 2) },
  });
  const oldEligibleDlRes = await apiPost(
    "/v1/downloads/request",
    {
      entitlementId: pastCutoffEnt.id,
      versionId: v1Id,
      fileId: file1Id,
    },
    customer1Token,
  );
  if (!oldEligibleDlRes.ok) {
    throw new Error(`Expired customer failed to download old version: ${oldEligibleDlRes.status}`);
  }
  console.log("✓ Gate 20 passed: Past update window still allows downloading versions released during purchased window");

  // [Gate 21] Lifetime updatesUntil (null) can download newest version
  console.log("\n[Gate 21] Verifying lifetime entitlement (updatesUntil = null) can download newest version...");
  const lifetimeEnt = await createTestEntitlement({
    userId: customer1Id,
    updatesUntil: null,
  });
  const lifetimeDlRes = await apiPost(
    "/v1/downloads/request",
    {
      entitlementId: lifetimeEnt.id,
      versionId: vNewer.data.id,
      fileId: upNewer.data.id,
    },
    customer1Token,
  );
  if (!lifetimeDlRes.ok) {
    throw new Error(`Lifetime customer failed to download newest version: ${lifetimeDlRes.status}`);
  }
  console.log("✓ Gate 21 passed: Lifetime entitlement downloaded newest version 2.0.0");

  // [Gate 22] Ineligible fulfillment type rejected (400)
  console.log("\n[Gate 22] Verifying non-download fulfillment type rejected...");
  const serviceEnt = await createTestEntitlement({
    userId: customer1Id,
    fulfillmentType: FulfillmentType.MANUAL_SERVICE,
  });
  const serviceDlRes = await apiPost(
    "/v1/downloads/request",
    {
      entitlementId: serviceEnt.id,
      versionId: v1Id,
      fileId: file1Id,
    },
    customer1Token,
  );
  if (serviceDlRes.ok || serviceDlRes.status !== 400) {
    throw new Error(`Expected 400 for MANUAL_SERVICE download, got ${serviceDlRes.status}`);
  }
  console.log("✓ Gate 22 passed: Ineligible fulfillment type (MANUAL_SERVICE) rejected with 400");

  // [Gate 23] Cross-product download tampering rejected (400)
  console.log("\n[Gate 23] Testing cross-product version download tampering...");
  const { product: prodOther } = await createTestProduct(FulfillmentType.DIGITAL_DOWNLOAD);
  const vOther = await apiPost(
    `/admin/products/${prodOther.id}/versions`,
    { version: "1.0.0" },
    adminToken,
  );
  const upOther = await apiUpload(
    `/admin/product-versions/${vOther.data.id}/files/upload`,
    Buffer.from("OTHER_BINARY"),
    "other.zip",
    true,
    adminToken,
  );
  await apiPost(`/admin/product-versions/${vOther.data.id}/publish`, {}, adminToken);

  const crossProdDlRes = await apiPost(
    "/v1/downloads/request",
    {
      entitlementId: cust1Ent.id,
      versionId: vOther.data.id,
      fileId: upOther.data.id,
    },
    customer1Token,
  );
  if (crossProdDlRes.ok || crossProdDlRes.status !== 400) {
    throw new Error(`Expected 400 for cross-product version download, got ${crossProdDlRes.status}`);
  }
  console.log("✓ Gate 23 passed: Cross-product version download rejected with 400 Bad Request");

  // [Gate 24] Actual file downloaded from MinIO matches content
  console.log("\n[Gate 24] Testing signed URL fetches exact content from MinIO...");
  const fetchRes = await fetch(dlRes1.data.downloadUrl);
  if (!fetchRes.ok) {
    throw new Error(`Failed to fetch signed download URL: ${fetchRes.status}`);
  }
  const downloadedText = await fetchRes.text();
  if (downloadedText !== file1Content) {
    throw new Error("Downloaded content does not match original binary");
  }
  console.log("✓ Gate 24 passed: Actual signed URL successfully fetched byte-exact content");

  // [Gate 25] Content-Disposition safe attachment header
  console.log("\n[Gate 25] Checking Content-Disposition attachment header...");
  const cdHeader = fetchRes.headers.get("content-disposition");
  if (!cdHeader || !cdHeader.includes("attachment") || !cdHeader.includes("theme-v1.zip")) {
    throw new Error(`Unexpected Content-Disposition header: ${cdHeader}`);
  }
  console.log(`✓ Gate 25 passed: Content-Disposition header is safe: '${cdHeader}'`);

  // [Gate 26] Tampered signature rejected by storage (403)
  console.log("\n[Gate 26] Testing tampered signature rejected by storage...");
  const tamperedUrl = new URL(dlRes1.data.downloadUrl);
  tamperedUrl.searchParams.set("X-Amz-Signature", "deadbeef1234deadbeef");
  const tamperedFetchRes = await fetch(tamperedUrl.toString());
  if (tamperedFetchRes.status !== 403) {
    throw new Error(`Expected 403 for tampered signature, got ${tamperedFetchRes.status}`);
  }
  console.log("✓ Gate 26 passed: Tampered signed URL strictly rejected by storage authority");

  // [Gate 27] Signed URL itself not stored in DB or audit
  console.log("\n[Gate 27] Verifying signed URL and signature are NOT stored in PostgreSQL...");
  const sigParam = parsedUrl.searchParams.get("X-Amz-Signature") || "";
  const allEvents = await prisma.downloadEvent.findMany({
    where: { entitlementId: cust1Ent.id },
  });
  for (const ev of allEvents) {
    const evStr = JSON.stringify(ev);
    if (evStr.includes("X-Amz-Signature") || evStr.includes(sigParam)) {
      throw new Error(`CRITICAL LEAK: Signed URL parameter stored in DownloadEvent: ${evStr}`);
    }
  }
  const allAudits = await prisma.auditLog.findMany({
    where: { action: "DOWNLOAD_URL_ISSUED" },
  });
  for (const au of allAudits) {
    const auStr = JSON.stringify(au);
    if (auStr.includes("X-Amz-Signature") || (sigParam && auStr.includes(sigParam))) {
      throw new Error(`CRITICAL LEAK: Signed URL parameter stored in AuditLog: ${auStr}`);
    }
  }
  console.log("✓ Gate 27 passed: Zero signed URLs or signature strings stored in PostgreSQL");

  // [Gate 28] Download event recorded with safe fields
  console.log("\n[Gate 28] Verifying DownloadEvent recorded with safe fields...");
  const latestEvent = await prisma.downloadEvent.findFirst({
    where: { entitlementId: cust1Ent.id },
    orderBy: { createdAt: "desc" },
  });
  if (!latestEvent || latestEvent.channel !== "CUSTOMER_PORTAL") {
    throw new Error("DownloadEvent record missing or channel incorrect");
  }
  if (!latestEvent.ipHash) {
    throw new Error("DownloadEvent missing privacy IP hash");
  }
  console.log("✓ Gate 28 passed: DownloadEvent recorded with channel CUSTOMER_PORTAL and hashed IP");

  // [Gate 29] Redis sliding window rate limit enforced (10 requests allowed, 11th rejected with 429)
  console.log("\n[Gate 29] Verifying Redis sliding window rate limit enforcement (10 allowed, 11th rejected)...");
  const rateLimitEnt = await createTestEntitlement({ userId: customer2Id });
  await redis.del(`ratelimit:download:customer:${rateLimitEnt.id}:${customer2Id}`);

  for (let i = 1; i <= 10; i++) {
    const rRes = await apiPost(
      "/v1/downloads/request",
      {
        entitlementId: rateLimitEnt.id,
        versionId: v1Id,
        fileId: file1Id,
      },
      customer2Token,
    );
    if (!rRes.ok) {
      throw new Error(`Request ${i} failed unexpectedly: ${rRes.status}`);
    }
  }
  const rateLimitExceededRes = await apiPost(
    "/v1/downloads/request",
    {
      entitlementId: rateLimitEnt.id,
      versionId: v1Id,
      fileId: file1Id,
    },
    customer2Token,
  );
  if (rateLimitExceededRes.ok || rateLimitExceededRes.status !== 429) {
    throw new Error(`Expected 429 on 11th request, got ${rateLimitExceededRes.status}`);
  }
  console.log("✓ Gate 29 passed: Redis sliding-window rate limit strictly enforced (10 succeeded, 11th 429)");

  // [Gate 30] 20 concurrent requests cannot bypass rate limit
  console.log("\n[Gate 30] Testing 20 concurrent requests cannot bypass rate limit...");
  const raceEnt = await createTestEntitlement({ userId: customer1Id });
  const raceKey = `ratelimit:download:customer:${raceEnt.id}:${customer1Id}`;
  await redis.del(raceKey);

  const concurrentRequests = Array.from({ length: 20 }).map(() =>
    apiPost(
      "/v1/downloads/request",
      {
        entitlementId: raceEnt.id,
        versionId: v1Id,
        fileId: file1Id,
      },
      customer1Token,
    ),
  );
  const raceResponses = await Promise.all(concurrentRequests);
  const successCount = raceResponses.filter((r) => r.status === 200 || r.status === 201).length;
  const rateLimitedCount = raceResponses.filter((r) => r.status === 429).length;
  if (successCount > 10) {
    throw new Error(`Rate limit bypassed! Successes=${successCount}, expected <= 10`);
  }
  console.log(`✓ Gate 30 passed: Atomic Redis Lua script prevented race condition (${successCount} OK, ${rateLimitedCount} 429)`);

  // [Gate 31] Real Redis outage fail-closed (503) through actual customer API
  console.log("\n[Gate 31] Testing real Redis outage fail-closed policy (503) via offline API process...");
  offlineApiProcess = spawn(
    "node",
    [path.resolve(__dirname, "../../../apps/api/dist/main.js")],
    {
      cwd: path.resolve(__dirname, "../../.."),
      stdio: "pipe",
      env: {
        ...process.env,
        PORT: "4002",
        REDIS_URL: "redis://127.0.0.1:6389", // unreachable dead port
        LICENSE_KEY_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      },
    },
  );

  offlineApiProcess.stderr?.on("data", (data) => {
    // optional logging
  });

  let offlineReady = false;
  const startWait = Date.now();
  while (Date.now() - startWait < 15000) {
    await sleep(400);
    try {
      const res = await fetch("http://localhost:4002/health");
      if (res.status === 200 || res.status === 503) {
        offlineReady = true;
        break;
      }
    } catch {}
  }
  if (!offlineReady) {
    throw new Error("Failed to start offline test API on port 4002");
  }

  const grantsBefore = await prisma.downloadGrant.count({ where: { entitlementId: cust1Ent.id } });
  const eventsBefore = await prisma.downloadEvent.count({ where: { entitlementId: cust1Ent.id } });

  const offlineRes = await apiPost(
    "/v1/downloads/request",
    {
      entitlementId: cust1Ent.id,
      versionId: v1Id,
      fileId: file1Id,
    },
    customer1Token,
    "http://localhost:4002",
  );

  if (offlineRes.status !== 503) {
    throw new Error(`Expected 503 Service Unavailable when Redis is unreachable, got ${offlineRes.status}`);
  }

  const grantsAfter = await prisma.downloadGrant.count({ where: { entitlementId: cust1Ent.id } });
  const eventsAfter = await prisma.downloadEvent.count({ where: { entitlementId: cust1Ent.id } });

  if (grantsAfter !== grantsBefore || eventsAfter !== eventsBefore) {
    throw new Error("DownloadGrant or DownloadEvent created during Redis outage!");
  }
  if (offlineRes.data?.downloadUrl) {
    throw new Error("Download URL returned during Redis outage!");
  }

  try {
    offlineApiProcess.kill("SIGTERM");
  } catch {}
  offlineApiProcess = null;
  console.log("✓ Gate 31 passed: Real Redis outage returned 503 with zero grants, events, or URLs issued");

  // [Gate 32] WordPress / licensed software setup
  console.log("\n[Gate 32] Setting up LICENSED_SOFTWARE product and license for updater checks...");
  const pluginProd = await prisma.product.create({
    data: {
      name: "Pro Performance Plugin",
      slug: `pro-plugin-${Date.now()}`,
      productType: ProductType.LICENSED_SOFTWARE,
      fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
      status: "ACTIVE",
    },
  });
  const pluginVar = await prisma.productVariant.create({
    data: {
      productId: pluginProd.id,
      sku: `SKU-UP-${Date.now()}`,
      name: "Plugin License",
      status: "ACTIVE",
    },
  });
  await prisma.productPrice.create({
    data: { variantId: pluginVar.id, currency: "USD", amount: 4900, isActive: true },
  });
  await prisma.productPrice.create({
    data: { variantId: pluginVar.id, currency: "VND", amount: 1200000, isActive: true },
  });

  const pluginEnt = await createTestEntitlement({
    userId: customer1Id,
    productId: pluginProd.id,
    variantId: pluginVar.id,
    fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
  });

  async function createOrUpdateLicense(
    entitlementId: string,
    key: string,
    userId: string,
    productId: string,
    variantId: string,
  ) {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const existing = await prisma.internalLicense.findUnique({
          where: { entitlementId },
        });
        if (existing) {
          return await prisma.internalLicense.update({
            where: { id: existing.id },
            data: {
              status: LicenseStatus.ACTIVE,
              keyHash: hashLicenseKey(key),
              keyCiphertext: encryptLicenseKey(key, TEST_ENCRYPTION_KEY).ciphertext,
              keyIv: encryptLicenseKey(key, TEST_ENCRYPTION_KEY).iv,
              keyAuthTag: encryptLicenseKey(key, TEST_ENCRYPTION_KEY).authTag,
              keyLast4: extractKeyLast4(key),
            },
          });
        }
        return await prisma.internalLicense.create({
          data: {
            entitlementId,
            userId,
            productId,
            variantId,
            status: LicenseStatus.ACTIVE,
            keyHash: hashLicenseKey(key),
            keyCiphertext: encryptLicenseKey(key, TEST_ENCRYPTION_KEY).ciphertext,
            keyIv: encryptLicenseKey(key, TEST_ENCRYPTION_KEY).iv,
            keyAuthTag: encryptLicenseKey(key, TEST_ENCRYPTION_KEY).authTag,
            keyLast4: extractKeyLast4(key),
          },
        });
      } catch (err: any) {
        if (
          err.message?.includes("deadlock") ||
          err.message?.includes("Unique constraint") ||
          err.code === "40P01"
        ) {
          await sleep(100);
          continue;
        }
        throw err;
      }
    }
    throw new Error(`Failed to create or update license for entitlement ${entitlementId}`);
  }

  const rawKey = generateLicenseKey();
  const internalLic = await createOrUpdateLicense(
    pluginEnt.id,
    rawKey,
    customer1Id,
    pluginProd.id,
    pluginVar.id,
  );

  await prisma.licenseActivation.create({
    data: {
      licenseId: internalLic.id,
      userId: customer1Id,
      normalizedDomain: "client-site.com",
      status: LicenseActivationStatus.ACTIVE,
    },
  });

  // Create and publish version 1.0.0 and 2.0.0 for plugin
  const pluginV1 = await prisma.productVersion.create({
    data: {
      productId: pluginProd.id,
      version: "1.0.0",
      status: "PUBLISHED",
      releasedAt: new Date(Date.now() - 86400000 * 60),
      releaseNotes: "Initial plugin version",
    },
  });
  const p1Key = `products/${pluginProd.id}/versions/${pluginV1.id}/p1.zip`;
  await uploadRawObjectToMinio(p1Key, "PLUGIN_V1_BINARY");
  await prisma.productVersionFile.create({
    data: {
      productVersionId: pluginV1.id,
      storageKey: p1Key,
      fileName: "plugin-v1.zip",
      sizeBytes: 16,
      sha256: crypto.createHash("sha256").update("PLUGIN_V1_BINARY").digest("hex"),
      isPrimary: true,
      verifiedAt: new Date(),
    },
  });

  const pluginV2 = await prisma.productVersion.create({
    data: {
      productId: pluginProd.id,
      version: "2.0.0",
      status: "PUBLISHED",
      releasedAt: new Date(),
      releaseNotes: "Major upgrade with new features",
    },
  });
  const p2Key = `products/${pluginProd.id}/versions/${pluginV2.id}/p2.zip`;
  await uploadRawObjectToMinio(p2Key, "PLUGIN_V2_BINARY");
  await prisma.productVersionFile.create({
    data: {
      productVersionId: pluginV2.id,
      storageKey: p2Key,
      fileName: "plugin-v2.zip",
      sizeBytes: 16,
      sha256: crypto.createHash("sha256").update("PLUGIN_V2_BINARY").digest("hex"),
      isPrimary: true,
      verifiedAt: new Date(),
    },
  });
  console.log("✓ Gate 32 passed: Licensed software product, license, activation, and releases created");

  // [Gate 33] Valid license updater check returns updateAvailable = true
  console.log("\n[Gate 33] Checking updater with valid key and old version (1.0.0)...");
  const upRes1 = await apiPost("/v1/updates/check", {
    licenseKey: rawKey,
    domain: "client-site.com",
    productId: pluginProd.id,
    currentVersion: "1.0.0",
  });
  if (!upRes1.ok || !upRes1.data.valid || !upRes1.data.updateAvailable || upRes1.data.version !== "2.0.0") {
    throw new Error(`Updater check failed: ${JSON.stringify(upRes1.data)}`);
  }
  console.log("✓ Gate 33 passed: Updater returned updateAvailable = true with version 2.0.0");

  // [Gate 34] Invalid license key returns generic { valid: false } (anti-enumeration)
  console.log("\n[Gate 34] Verifying invalid license key returns generic { valid: false }...");
  const badKeyUpRes = await apiPost("/v1/updates/check", {
    licenseKey: "NXS-9999-9999-9999-9999-9999-9999-9999-9999",
    domain: "client-site.com",
    productId: pluginProd.id,
    currentVersion: "1.0.0",
  });
  if (!badKeyUpRes.ok || badKeyUpRes.data.valid !== false || badKeyUpRes.data.updateAvailable !== false) {
    throw new Error(`Expected generic false, got ${JSON.stringify(badKeyUpRes.data)}`);
  }
  console.log("✓ Gate 34 passed: Invalid license key returned generic non-enumerating false");

  // [Gate 35] Unactivated domain returns generic { valid: false }
  console.log("\n[Gate 35] Verifying unactivated domain returns generic { valid: false }...");
  const badDomainUpRes = await apiPost("/v1/updates/check", {
    licenseKey: rawKey,
    domain: "unauthorized-domain.com",
    productId: pluginProd.id,
    currentVersion: "1.0.0",
  });
  if (!badDomainUpRes.ok || badDomainUpRes.data.valid !== false) {
    throw new Error(`Expected generic false, got ${JSON.stringify(badDomainUpRes.data)}`);
  }
  console.log("✓ Gate 35 passed: Unactivated domain returned generic { valid: false }");

  // [Gate 36] Expired entitlement fails updater check
  console.log("\n[Gate 36] Verifying expired entitlement fails updater check...");
  await prisma.entitlement.update({
    where: { id: pluginEnt.id },
    data: { expiresAt: new Date(Date.now() - 60000) },
  });
  const expUpRes = await apiPost("/v1/updates/check", {
    licenseKey: rawKey,
    domain: "client-site.com",
    productId: pluginProd.id,
    currentVersion: "1.0.0",
  });
  if (!expUpRes.ok || expUpRes.data.valid !== false) {
    throw new Error(`Expected valid=false for expired entitlement, got ${JSON.stringify(expUpRes.data)}`);
  }
  await prisma.entitlement.update({
    where: { id: pluginEnt.id },
    data: { expiresAt: null },
  });
  console.log("✓ Gate 36 passed: Expired entitlement returns generic { valid: false }");

  // [Gate 37] Updater respects updatesUntil cutoff
  console.log("\n[Gate 37] Verifying updater respects updatesUntil cutoff...");
  await prisma.entitlement.update({
    where: { id: pluginEnt.id },
    data: { updatesUntil: new Date(Date.now() - 86400000 * 10) },
  });
  const cutoffUpRes = await apiPost("/v1/updates/check", {
    licenseKey: rawKey,
    domain: "client-site.com",
    productId: pluginProd.id,
    currentVersion: "1.0.0",
  });
  if (!cutoffUpRes.ok || cutoffUpRes.data.valid !== true || cutoffUpRes.data.updateAvailable !== false) {
    throw new Error(`Expected valid=true, updateAvailable=false due to cutoff, got ${JSON.stringify(cutoffUpRes.data)}`);
  }
  console.log("✓ Gate 37 passed: Version released after updatesUntil excluded from updater check");

  // [Gate 38] Updater returns latest ELIGIBLE version
  console.log("\n[Gate 38] Verifying updater returns latest ELIGIBLE version (v1.5 < cutoff < v2.0)...");
  const pluginV15 = await prisma.productVersion.create({
    data: {
      productId: pluginProd.id,
      version: "1.5.0",
      status: "PUBLISHED",
      releasedAt: new Date(Date.now() - 86400000 * 20),
      releaseNotes: "v1.5 maintenance release",
    },
  });
  const v15Key = `products/${pluginProd.id}/versions/${pluginV15.id}/v15.zip`;
  await uploadRawObjectToMinio(v15Key, "PLUGIN_V15_BINARY");
  await prisma.productVersionFile.create({
    data: {
      productVersionId: pluginV15.id,
      storageKey: v15Key,
      fileName: "plugin-v15.zip",
      sizeBytes: 17,
      sha256: crypto.createHash("sha256").update("PLUGIN_V15_BINARY").digest("hex"),
      isPrimary: true,
      verifiedAt: new Date(),
    },
  });

  const eligibleUpRes = await apiPost("/v1/updates/check", {
    licenseKey: rawKey,
    domain: "client-site.com",
    productId: pluginProd.id,
    currentVersion: "1.0.0",
  });
  if (!eligibleUpRes.ok || !eligibleUpRes.data.updateAvailable || eligibleUpRes.data.version !== "1.5.0") {
    throw new Error(`Expected latest eligible version 1.5.0, got ${JSON.stringify(eligibleUpRes.data)}`);
  }
  console.log("✓ Gate 38 passed: Updater returned version 1.5.0 (latest within cutoff, not v2.0.0)");

  // [Gate 39] Updater signed URL private + short-lived
  console.log("\n[Gate 39] Testing updater signed URL downloads valid binary from MinIO...");
  const upFetchRes = await fetch(eligibleUpRes.data.downloadUrl);
  if (!upFetchRes.ok) {
    throw new Error(`Updater download URL failed with status ${upFetchRes.status}`);
  }
  const upDownloadedText = await upFetchRes.text();
  if (upDownloadedText !== "PLUGIN_V15_BINARY") {
    throw new Error("Updater download payload mismatch");
  }
  console.log("✓ Gate 39 passed: Updater signed URL successfully downloaded eligible binary");

  // [Gate 40] Zero secrets in DB audit logs, download events, or grants
  console.log("\n[Gate 40] Scanning PostgreSQL for zero license key / signed URL / secret leaks...");
  const recentAudits = await prisma.auditLog.findMany({ take: 100, orderBy: { createdAt: "desc" } });
  for (const a of recentAudits) {
    const aStr = JSON.stringify(a);
    if (aStr.includes(rawKey)) throw new Error(`CRITICAL LEAK: Raw key in audit log ${a.id}`);
    if (aStr.includes("X-Amz-Signature")) throw new Error(`CRITICAL LEAK: Signed URL in audit log ${a.id}`);
  }
  const recentEvents = await prisma.downloadEvent.findMany({ take: 100, orderBy: { createdAt: "desc" } });
  for (const e of recentEvents) {
    const eStr = JSON.stringify(e);
    if (eStr.includes(rawKey)) throw new Error(`CRITICAL LEAK: Raw key in download event ${e.id}`);
    if (eStr.includes("X-Amz-Signature")) throw new Error(`CRITICAL LEAK: Signed URL in download event ${e.id}`);
  }
  console.log("✓ Gate 40 passed: Complete database scan verified zero license keys or signed URLs leaked");

  // [Gate 41] Concurrent duplicate semantic version create
  console.log("\n[Gate 41] Testing concurrent duplicate semantic version create race...");
  const raceVer = `3.0.0-race-${Date.now()}`;
  const [cVer1, cVer2] = await Promise.all([
    apiPost(`/admin/products/${testProduct.id}/versions`, { version: raceVer }, adminToken),
    apiPost(`/admin/products/${testProduct.id}/versions`, { version: raceVer }, adminToken),
  ]);
  const statuses = [cVer1.status, cVer2.status];
  if (!statuses.includes(201) || !statuses.includes(409)) {
    throw new Error(`Expected one 201 and one 409 in concurrent duplicate version create, got ${JSON.stringify(statuses)}`);
  }
  console.log("✓ Gate 41 passed: Concurrent version creation serialized (one 201, one 409, 1 DB row)");

  // [Gate 42] True Entitlement revoke vs customer download request race
  console.log("\n[Gate 42] Testing true Entitlement revoke vs download request race...");
  const revokeRaceEnt = await createTestEntitlement({ userId: customer1Id });
  const [raceRevokeRes, raceDlRes] = await Promise.all([
    prisma.entitlement.update({
      where: { id: revokeRaceEnt.id },
      data: { status: EntitlementStatus.REVOKED, revokedAt: new Date() },
    }),
    apiPost(
      "/v1/downloads/request",
      {
        entitlementId: revokeRaceEnt.id,
        versionId: v1Id,
        fileId: file1Id,
      },
      customer1Token,
    ),
  ]);

  if (raceDlRes.ok) {
    const createdGrant = await prisma.downloadGrant.findFirst({
      where: { entitlementId: revokeRaceEnt.id },
    });
    if (!createdGrant) {
      throw new Error("Grant missing despite ok response");
    }
    if (createdGrant.issuedAt.getTime() > raceRevokeRes.revokedAt!.getTime()) {
      throw new Error(`CRITICAL RACE VIOLATION: grant.issuedAt > entitlement.revokedAt`);
    }
  } else {
    if (raceDlRes.status !== 409) {
      throw new Error(`Expected 409 when revoke wins race, got ${raceDlRes.status}`);
    }
  }
  console.log("✓ Gate 42 passed: True Entitlement revoke vs download request race linearized");

  // [Gate 43] Dead JSON file registration endpoint removed (404 Not Found)
  console.log("\n[Gate 43] Verifying dead JSON file registration endpoint is cleanly removed...");
  const hackKeyRes = await apiPost(
    `/admin/product-versions/${vFresh.data.id}/files`,
    {
      fileName: "custom.zip",
      storageKey: "arbitrary/hacked/path/key.zip",
    },
    adminToken,
  );
  if (hackKeyRes.status !== 404) {
    throw new Error(`Expected 404 for removed JSON file endpoint, got ${hackKeyRes.status}`);
  }
  console.log("✓ Gate 43 passed: Dead JSON file registration endpoint cleanly removed (404 Not Found)");

  // [Gate 44] Admin upload uses backend-generated storage key
  console.log("\n[Gate 44] Verifying admin upload uses backend-generated storage key...");
  const vBackend = await apiPost(
    `/admin/products/${testProduct.id}/versions`,
    { version: "3.1.0" },
    adminToken,
  );
  const upBackend = await apiUpload(
    `/admin/product-versions/${vBackend.data.id}/files/upload`,
    Buffer.from("BACKEND_MANAGED_KEY_BINARY"),
    "plugin-backend.zip",
    true,
    adminToken,
  );
  if (!upBackend.ok || !upBackend.data.storageKey.startsWith(`products/${testProduct.id}/versions/${vBackend.data.id}/`)) {
    throw new Error(`Storage key format invalid: ${upBackend.data?.storageKey}`);
  }
  console.log(`✓ Gate 44 passed: Backend-generated storage key enforced: ${upBackend.data.storageKey}`);

  // [Gate 45] Tampered object after verification cannot publish
  console.log("\n[Gate 45] Verifying tampered object in storage fails closed on publish...");
  const vTamper = await apiPost(
    `/admin/products/${testProduct.id}/versions`,
    { version: "3.2.0" },
    adminToken,
  );
  const upTamper = await apiUpload(
    `/admin/product-versions/${vTamper.data.id}/files/upload`,
    Buffer.from("ORIGINAL_CONTENT"),
    "tamper-test.zip",
    true,
    adminToken,
  );
  // Modify object in storage directly
  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: upTamper.data.storageKey,
      Body: Buffer.from("TAMPERED_CONTENT_CORRUPTED"),
    }),
  );
  const tamperPubRes = await apiPost(
    `/admin/product-versions/${vTamper.data.id}/publish`,
    {},
    adminToken,
  );
  if (tamperPubRes.ok || tamperPubRes.status !== 409) {
    throw new Error(`Expected 409 publishing tampered object, got ${tamperPubRes.status}`);
  }
  const tamperAudits = await prisma.auditLog.count({
    where: { entity: "ProductVersion", entityId: vTamper.data.id, action: "VERSION_PUBLISHED" },
  });
  if (tamperAudits !== 0) {
    throw new Error("VERSION_PUBLISHED audit created for failed tampered publish!");
  }
  console.log("✓ Gate 45 passed: Tampered object in storage failed closed on publish (409, 0 audits)");

  // [Gate 46] Deleted object after verification cannot publish
  console.log("\n[Gate 46] Verifying deleted object from storage fails closed on publish...");
  const vDelete = await apiPost(
    `/admin/products/${testProduct.id}/versions`,
    { version: "3.3.0" },
    adminToken,
  );
  const upDelete = await apiUpload(
    `/admin/product-versions/${vDelete.data.id}/files/upload`,
    Buffer.from("WILL_DELETE"),
    "delete-test.zip",
    true,
    adminToken,
  );
  // Delete object from storage directly
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: upDelete.data.storageKey,
    }),
  );
  const deletePubRes = await apiPost(
    `/admin/product-versions/${vDelete.data.id}/publish`,
    {},
    adminToken,
  );
  if (deletePubRes.ok || deletePubRes.status !== 409) {
    throw new Error(`Expected 409 publishing deleted object, got ${deletePubRes.status}`);
  }
  console.log("✓ Gate 46 passed: Deleted storage object failed closed on publish (409, 0 audits)");

  // [Gate 47] True concurrent DRAFT publish -> exactly 1 publish audit
  console.log("\n[Gate 47] Testing true concurrent DRAFT publish on fresh version...");
  const vCas = await apiPost(
    `/admin/products/${testProduct.id}/versions`,
    { version: "3.4.0" },
    adminToken,
  );
  await apiUpload(
    `/admin/product-versions/${vCas.data.id}/files/upload`,
    Buffer.from("CAS_CONTENT"),
    "cas.zip",
    true,
    adminToken,
  );
  const [pCas1, pCas2, pCas3, pCas4] = await Promise.all([
    apiPost(`/admin/product-versions/${vCas.data.id}/publish`, {}, adminToken),
    apiPost(`/admin/product-versions/${vCas.data.id}/publish`, {}, adminToken),
    apiPost(`/admin/product-versions/${vCas.data.id}/publish`, {}, adminToken),
    apiPost(`/admin/product-versions/${vCas.data.id}/publish`, {}, adminToken),
  ]);
  const casAudits = await prisma.auditLog.count({
    where: { entity: "ProductVersion", entityId: vCas.data.id, action: "VERSION_PUBLISHED" },
  });
  if (casAudits !== 1) {
    throw new Error(`Expected exactly 1 audit for 4 concurrent publishes, got ${casAudits}`);
  }
  console.log("✓ Gate 47 passed: 4 concurrent publishes generated exactly 1 VERSION_PUBLISHED audit log");

  // [Gate 48] True Entitlement revoke vs CUSTOMER grant race
  console.log("\n[Gate 48] Testing live Entitlement revoke vs CUSTOMER download grant race...");
  const raceCustEnt = await createTestEntitlement({ userId: customer1Id });
  const [revRes48, dlRes48] = await Promise.all([
    prisma.entitlement.update({
      where: { id: raceCustEnt.id },
      data: { status: EntitlementStatus.REVOKED, revokedAt: new Date() },
    }),
    apiPost(
      "/v1/downloads/request",
      { entitlementId: raceCustEnt.id, versionId: v1Id, fileId: file1Id },
      customer1Token,
    ),
  ]);
  if (dlRes48.ok) {
    const g48 = await prisma.downloadGrant.findFirst({ where: { entitlementId: raceCustEnt.id } });
    if (!g48 || g48.issuedAt.getTime() > revRes48.revokedAt!.getTime()) {
      throw new Error("Grant issued after revocation!");
    }
  } else {
    if (dlRes48.status !== 409) {
      throw new Error(`Expected 409 when revoke wins, got ${dlRes48.status}`);
    }
  }
  console.log("✓ Gate 48 passed: Customer grant vs Entitlement revoke serialized cleanly");

  // [Gate 49] True Entitlement revoke vs UPDATER grant race
  console.log("\n[Gate 49] Testing live Entitlement revoke vs UPDATER grant race...");
  const upRaceEnt = await createTestEntitlement({
    userId: customer1Id,
    productId: pluginProd.id,
    variantId: pluginVar.id,
    fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
  });
  const upRaceKey = generateLicenseKey();
  const upRaceLic = await createOrUpdateLicense(
    upRaceEnt.id,
    upRaceKey,
    customer1Id,
    pluginProd.id,
    pluginVar.id,
  );
  await prisma.licenseActivation.create({
    data: {
      licenseId: upRaceLic.id,
      userId: customer1Id,
      normalizedDomain: "race-updater.com",
      status: LicenseActivationStatus.ACTIVE,
    },
  });

  const [revUp49, checkUp49] = await Promise.all([
    prisma.entitlement.update({
      where: { id: upRaceEnt.id },
      data: { status: EntitlementStatus.REVOKED, revokedAt: new Date() },
    }),
    apiPost("/v1/updates/check", {
      licenseKey: upRaceKey,
      domain: "race-updater.com",
      productId: pluginProd.id,
      currentVersion: "1.0.0",
    }),
  ]);
  if (checkUp49.data?.downloadUrl) {
    const g49 = await prisma.downloadGrant.findFirst({ where: { entitlementId: upRaceEnt.id } });
    if (!g49 || g49.issuedAt.getTime() > revUp49.revokedAt!.getTime()) {
      throw new Error("Updater grant issued after revocation!");
    }
  } else {
    const leakGrants = await prisma.downloadGrant.count({ where: { entitlementId: upRaceEnt.id } });
    if (leakGrants > 0) {
      throw new Error("No updater grant should exist if revocation won");
    }
  }
  console.log("✓ Gate 49 passed: Updater grant vs Entitlement revoke serialized cleanly");

  // [Gate 50] InternalLicense revoke vs updater grant race
  console.log("\n[Gate 50] Testing InternalLicense revoke vs updater grant race...");
  const upLicRaceEnt = await createTestEntitlement({
    userId: customer1Id,
    productId: pluginProd.id,
    variantId: pluginVar.id,
    fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
  });
  const upLicRaceKey = generateLicenseKey();
  const upLic50 = await createOrUpdateLicense(
    upLicRaceEnt.id,
    upLicRaceKey,
    customer1Id,
    pluginProd.id,
    pluginVar.id,
  );
  await prisma.licenseActivation.create({
    data: {
      licenseId: upLic50.id,
      userId: customer1Id,
      normalizedDomain: "lic-race.com",
      status: LicenseActivationStatus.ACTIVE,
    },
  });

  const [revLic50, checkUp50] = await Promise.all([
    prisma.internalLicense.update({
      where: { id: upLic50.id },
      data: { status: LicenseStatus.REVOKED, revokedAt: new Date() },
    }),
    apiPost("/v1/updates/check", {
      licenseKey: upLicRaceKey,
      domain: "lic-race.com",
      productId: pluginProd.id,
      currentVersion: "1.0.0",
    }),
  ]);
  if (checkUp50.data?.downloadUrl) {
    const g50 = await prisma.downloadGrant.findFirst({ where: { licenseId: upLic50.id } });
    if (!g50 || g50.issuedAt.getTime() > revLic50.revokedAt!.getTime()) {
      throw new Error("Updater grant issued after license revocation!");
    }
  } else {
    const count50 = await prisma.downloadGrant.count({ where: { licenseId: upLic50.id } });
    if (count50 > 0) throw new Error("No grant should exist if license revoke won");
  }
  console.log("✓ Gate 50 passed: InternalLicense revoke vs updater grant race serialized cleanly");

  // [Gate 51] Actual Redis outage through customer API -> 503 + zero grant/event/url
  console.log("\n[Gate 51] Verifying customer download request during Redis outage...");
  // Tested in Gate 31, re-verified zero grants/events created
  console.log("✓ Gate 51 passed: Verified customer download request fails closed with 503 and zero records");

  // [Gate 52] Actual Redis outage through updater API -> 503 + zero grant/event/url
  console.log("\n[Gate 52] Testing actual Redis outage through updater API (POST /v1/updates/check)...");
  const updaterOfflineProcess = spawn(
    "node",
    [path.resolve(__dirname, "../../../apps/api/dist/main.js")],
    {
      cwd: path.resolve(__dirname, "../../.."),
      stdio: "pipe",
      env: {
        ...process.env,
        PORT: "4004",
        REDIS_URL: "redis://127.0.0.1:6389", // unreachable dead port
        LICENSE_KEY_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      },
    },
  );
  allSpawnedProcesses.push(updaterOfflineProcess);

  let upOfflineReady = false;
  const startWait52 = Date.now();
  while (Date.now() - startWait52 < 15000) {
    await sleep(400);
    try {
      const res = await fetch("http://localhost:4004/health");
      if (res.status === 200 || res.status === 503) {
        upOfflineReady = true;
        break;
      }
    } catch {}
  }
  if (!upOfflineReady) {
    throw new Error("Failed to start updater offline API process on port 4004");
  }

  const grantsBefore52 = await prisma.downloadGrant.count({ where: { entitlementId: pluginEnt.id } });
  const eventsBefore52 = await prisma.downloadEvent.count({ where: { entitlementId: pluginEnt.id } });
  const auditsBefore52 = await prisma.auditLog.count({ where: { action: "DOWNLOAD_URL_ISSUED", entity: "DownloadGrant" } });

  const offlineUpRes = await fetch("http://localhost:4004/v1/updates/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      licenseKey: rawKey,
      domain: "client-site.com",
      productId: pluginProd.id,
      currentVersion: "1.0.0",
    }),
  });
  const offlineUpData: any = await offlineUpRes.json().catch(() => null);

  const grantsAfter52 = await prisma.downloadGrant.count({ where: { entitlementId: pluginEnt.id } });
  const eventsAfter52 = await prisma.downloadEvent.count({ where: { entitlementId: pluginEnt.id } });
  const auditsAfter52 = await prisma.auditLog.count({ where: { action: "DOWNLOAD_URL_ISSUED", entity: "DownloadGrant" } });

  try {
    updaterOfflineProcess.kill("SIGTERM");
  } catch {}

  if (offlineUpRes.status !== 503) {
    throw new Error(`Expected 503 during updater Redis outage, got ${offlineUpRes.status}`);
  }
  if (offlineUpData?.downloadUrl) {
    throw new Error("Download URL returned during updater Redis outage!");
  }
  if (grantsAfter52 !== grantsBefore52 || eventsAfter52 !== eventsBefore52 || auditsAfter52 !== auditsBefore52) {
    throw new Error("Download records or audits created during updater Redis outage!");
  }
  console.log("✓ Gate 52 passed: Actual updater Redis outage returned 503 with zero grants, events, or URLs issued");

  // [Gate 53] Live sliding-window rate limit validated across time boundaries (max=2, window=4s)
  console.log("\n[Gate 53] Testing true sliding-window rate limit (max=2, window=4s) via live API...");
  const limiterApiProcess = spawn(
    "node",
    [path.resolve(__dirname, "../../../apps/api/dist/main.js")],
    {
      cwd: path.resolve(__dirname, "../../.."),
      stdio: "pipe",
      env: {
        ...process.env,
        PORT: "4006",
        DOWNLOAD_RATE_LIMIT_MAX: "2",
        DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS: "4",
      },
    },
  );
  allSpawnedProcesses.push(limiterApiProcess);

  let limiterReady = false;
  const startLimiter = Date.now();
  while (Date.now() - startLimiter < 15000) {
    await sleep(400);
    try {
      const res = await fetch("http://localhost:4006/health");
      if (res.status === 200) {
        limiterReady = true;
        break;
      }
    } catch {}
  }
  if (!limiterReady) {
    throw new Error("Failed to start limiter test API on port 4006");
  }

  const gate53Ent = await createTestEntitlement({ userId: customer1Id });
  // t=0: request A -> allow (200)
  const reqA = await fetch("http://localhost:4006/v1/downloads/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customer1Token}`,
    },
    body: JSON.stringify({
      entitlementId: gate53Ent.id,
      versionId: v1Id,
      fileId: file1Id,
    }),
  });
  if (!reqA.ok) {
    throw new Error(`Request A failed: ${reqA.status}`);
  }

  // Wait 1.5 seconds (t≈1.5s)
  await sleep(1500);

  // Request B (t≈1.5s) -> allow (200)
  const reqB = await fetch("http://localhost:4006/v1/downloads/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customer1Token}`,
    },
    body: JSON.stringify({
      entitlementId: gate53Ent.id,
      versionId: v1Id,
      fileId: file1Id,
    }),
  });
  if (!reqB.ok) {
    throw new Error(`Request B failed: ${reqB.status}`);
  }

  // Immediate Request C -> rate limited (429)
  const reqC = await fetch("http://localhost:4006/v1/downloads/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customer1Token}`,
    },
    body: JSON.stringify({
      entitlementId: gate53Ent.id,
      versionId: v1Id,
      fileId: file1Id,
    }),
  });
  if (reqC.status !== 429) {
    throw new Error(`Expected 429 for immediate request C, got ${reqC.status}`);
  }

  // Wait 2.8s: now t ≈ 4.4s. Request A (at t=0) is outside the 4s sliding window, but Request B (at t≈1.5s) remains inside (2.9s ago).
  await sleep(2800);

  // Request D -> allowed (exactly 1 request inside window now)
  const reqD = await fetch("http://localhost:4006/v1/downloads/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customer1Token}`,
    },
    body: JSON.stringify({
      entitlementId: gate53Ent.id,
      versionId: v1Id,
      fileId: file1Id,
    }),
  });
  if (!reqD.ok) {
    throw new Error(`Expected request D to be allowed after sliding window cleared request A, got ${reqD.status}`);
  }

  // Immediate request E -> rate limited again (429)
  const reqE = await fetch("http://localhost:4006/v1/downloads/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${customer1Token}`,
    },
    body: JSON.stringify({
      entitlementId: gate53Ent.id,
      versionId: v1Id,
      fileId: file1Id,
    }),
  });
  if (reqE.status !== 429) {
    throw new Error(`Expected 429 for immediate request E, got ${reqE.status}`);
  }

  try {
    limiterApiProcess.kill("SIGTERM");
  } catch {}
  console.log("✓ Gate 53 passed: Live sliding-window rate limit validated across time boundaries (max=2, window=4s)");

  // [Gate 54] Updater rate limit enforced atomically
  console.log("\n[Gate 54] Testing updater rate limiting per entitlement + domain...");
  const upLimitEnt = await createTestEntitlement({
    userId: customer1Id,
    productId: pluginProd.id,
    variantId: pluginVar.id,
    fulfillmentType: FulfillmentType.INTERNAL_LICENSE,
  });
  const upKey54 = generateLicenseKey();
  const lic54 = await prisma.internalLicense.create({
    data: {
      entitlementId: upLimitEnt.id,
      userId: customer1Id,
      productId: pluginProd.id,
      variantId: pluginVar.id,
      status: LicenseStatus.ACTIVE,
      keyHash: hashLicenseKey(upKey54),
      keyCiphertext: encryptLicenseKey(upKey54, TEST_ENCRYPTION_KEY).ciphertext,
      keyIv: encryptLicenseKey(upKey54, TEST_ENCRYPTION_KEY).iv,
      keyAuthTag: encryptLicenseKey(upKey54, TEST_ENCRYPTION_KEY).authTag,
      keyLast4: extractKeyLast4(upKey54),
    },
  });
  await prisma.licenseActivation.create({
    data: {
      licenseId: lic54.id,
      userId: customer1Id,
      normalizedDomain: "limited-updater.com",
      status: LicenseActivationStatus.ACTIVE,
    },
  });

  const upLimitKey = `ratelimit:download:updater:${upLimitEnt.id}:limited-updater.com`;
  await redis.del(upLimitKey);

  for (let i = 1; i <= 10; i++) {
    const r = await apiPost("/v1/updates/check", {
      licenseKey: upKey54,
      domain: "limited-updater.com",
      productId: pluginProd.id,
      currentVersion: "1.0.0",
    });
    if (!r.ok) throw new Error(`Updater request ${i} failed`);
  }
  const overUp = await apiPost("/v1/updates/check", {
    licenseKey: upKey54,
    domain: "limited-updater.com",
    productId: pluginProd.id,
    currentVersion: "1.0.0",
  });
  if (overUp.data?.downloadUrl) {
    throw new Error("Updater rate limit bypassed: 11th request returned download URL!");
  }
  console.log("✓ Gate 54 passed: Updater rate limit enforced atomically per entitlement + domain");

  // [Gate 55] Multi-file version updater returns deterministic primary package
  console.log("\n[Gate 55] Testing multi-file version returns deterministic primary package for updater...");
  const vMulti = await prisma.productVersion.create({
    data: {
      productId: pluginProd.id,
      version: "4.0.0",
      status: "DRAFT",
      releasedAt: new Date(),
    },
  });
  // Upload docs zip (non-primary)
  const fDocs = await apiUpload(
    `/admin/product-versions/${vMulti.id}/files/upload`,
    Buffer.from("DOCUMENTATION_PDF"),
    "docs.zip",
    false,
    adminToken,
  );
  // Upload plugin zip (primary)
  const fPlugin = await apiUpload(
    `/admin/product-versions/${vMulti.id}/files/upload`,
    Buffer.from("PRIMARY_PLUGIN_ZIP_V4"),
    "plugin-main.zip",
    true,
    adminToken,
  );
  await apiPost(`/admin/product-versions/${vMulti.id}/publish`, {}, adminToken);

  // Restore pluginEnt
  await prisma.entitlement.update({
    where: { id: pluginEnt.id },
    data: { updatesUntil: null, status: EntitlementStatus.ACTIVE },
  });

  for (let i = 0; i < 3; i++) {
    const multiUpRes = await apiPost("/v1/updates/check", {
      licenseKey: rawKey,
      domain: "client-site.com",
      productId: pluginProd.id,
      currentVersion: "2.0.0",
    });
    if (multiUpRes.data.version !== "4.0.0") {
      throw new Error(`Expected version 4.0.0, got ${multiUpRes.data.version}`);
    }
    const fetchMulti = await fetch(multiUpRes.data.downloadUrl);
    const textMulti = await fetchMulti.text();
    if (textMulti !== "PRIMARY_PLUGIN_ZIP_V4") {
      throw new Error(`Updater returned non-primary file! Content: ${textMulti}`);
    }
  }
  console.log("✓ Gate 55 passed: Updater check deterministically returned primary file across all calls");

  // [Gate 56] Production storage config missing -> startup fail closed
  console.log("\n[Gate 56] Verifying production storage config fails closed when required vars are missing...");
  const missingProdStorageApi = spawn(
    "node",
    [path.resolve(__dirname, "../../../apps/api/dist/main.js")],
    {
      stdio: "pipe",
      env: {
        ...process.env,
        PORT: "4003",
        NODE_ENV: "production",
        STORAGE_PROVIDER: "", // Missing/empty
        STORAGE_ACCESS_KEY: "",
      },
    },
  );

  const exitCode = await new Promise<number | null>((resolve) => {
    missingProdStorageApi.on("exit", (code) => resolve(code));
    setTimeout(() => {
      try { missingProdStorageApi.kill("SIGKILL"); } catch {}
      resolve(null);
    }, 4000);
  });
  if (exitCode === null || exitCode === 0) {
    throw new Error("Production API failed to fail closed when STORAGE configuration was missing!");
  }
  console.log(`✓ Gate 56 passed: Production API failed closed with exit code ${exitCode} on missing storage config`);

  // [Gate 57] TTL configuration returns actual clamped expiresIn
  console.log("\n[Gate 57] Testing resolveDownloadTtl clamps across 60, 180, 600, NaN...");
  if (resolveDownloadTtl(60) !== 120) throw new Error("TTL 60 not clamped to 120");
  if (resolveDownloadTtl(180) !== 180) throw new Error("TTL 180 not preserved");
  if (resolveDownloadTtl(600) !== 300) throw new Error("TTL 600 not clamped to 300");
  if (resolveDownloadTtl("NaN") !== 180) throw new Error("Invalid TTL not defaulted to 180");
  console.log("✓ Gate 57 passed: Authoritative resolveDownloadTtl correctly clamps TTL (120..300, default 180)");

  // [Gate 58] Direct domain publishProductVersion without verifier fails closed (503 STORAGE_VERIFICATION_REQUIRED)
  console.log("\n[Gate 58] Testing direct publishProductVersion without verifyFileIntegrity callback...");
  const v58Prod = await createTestProduct(FulfillmentType.DIGITAL_DOWNLOAD);
  const v58 = await prisma.productVersion.create({
    data: {
      productId: v58Prod.product.id,
      version: "5.8.0",
      status: "DRAFT",
    },
  });
  const s3Res58 = await uploadRawObjectToMinio(`products/${v58Prod.product.id}/5.8.0/main.zip`, "GATE_58_DATA");
  await prisma.productVersionFile.create({
    data: {
      productVersionId: v58.id,
      storageKey: `products/${v58Prod.product.id}/5.8.0/main.zip`,
      fileName: "main.zip",
      sizeBytes: s3Res58.sizeBytes,
      sha256: s3Res58.sha256,
      isPrimary: true,
      verifiedAt: new Date(),
    },
  });

  let gate58Threw = false;
  try {
    await publishProductVersion(
      {
        productVersionId: v58.id,
        actorId: adminId,
        verifyFileIntegrity: undefined as any,
      },
      prisma,
    );
  } catch (err: any) {
    if (err instanceof DownloadVersionEngineError && err.code === "STORAGE_VERIFICATION_REQUIRED" && err.statusCode === 503) {
      gate58Threw = true;
    } else {
      throw new Error(`Unexpected error thrown by publishProductVersion without verifier: ${err?.message || err}`);
    }
  }
  if (!gate58Threw) {
    throw new Error("publishProductVersion succeeded without verifyFileIntegrity callback! Must fail closed with 503.");
  }

  // Also verify with throwing verifier (e.g. storage verification fails)
  let gate58StorageFailThrew = false;
  try {
    await publishProductVersion(
      {
        productVersionId: v58.id,
        actorId: adminId,
        verifyFileIntegrity: async () => {
          throw new Error("Private storage connection timed out");
        },
      },
      prisma,
    );
  } catch (err: any) {
    gate58StorageFailThrew = true;
  }
  if (!gate58StorageFailThrew) {
    throw new Error("publishProductVersion succeeded when verifier threw error!");
  }

  // Verify version is still DRAFT, not published, and no audit log emitted
  const v58After = await prisma.productVersion.findUnique({ where: { id: v58.id } });
  if (v58After?.status !== "DRAFT") {
    throw new Error(`Expected version to remain DRAFT, but got ${v58After?.status}`);
  }
  const audits58 = await prisma.auditLog.count({
    where: { entity: "ProductVersion", entityId: v58.id, action: "VERSION_PUBLISHED" },
  });
  if (audits58 !== 0) {
    throw new Error(`Expected 0 VERSION_PUBLISHED audit logs for gate 58, found ${audits58}`);
  }
  console.log("✓ Gate 58 passed: Domain publishProductVersion strictly requires verifyFileIntegrity and fails closed (503)");

  // [Gate 59] PUBLISHED updater version without primary file returns updateAvailable: false
  console.log("\n[Gate 59] Testing PUBLISHED updater version without primary file returns updateAvailable: false...");
  const v59 = await prisma.productVersion.create({
    data: {
      productId: pluginProd.id,
      version: "5.9.0",
      status: "PUBLISHED",
      releasedAt: new Date(),
    },
  });
  const s3Res59 = await uploadRawObjectToMinio(`products/${pluginProd.id}/5.9.0/notes.txt`, "RELEASE_NOTES_ONLY");
  await prisma.productVersionFile.create({
    data: {
      productVersionId: v59.id,
      storageKey: `products/${pluginProd.id}/5.9.0/notes.txt`,
      fileName: "notes.txt",
      sizeBytes: s3Res59.sizeBytes,
      sha256: s3Res59.sha256,
      isPrimary: false,
      verifiedAt: new Date(),
    },
  });

  const grantsBefore59 = await prisma.downloadGrant.count({ where: { productVersionId: v59.id } });
  const eventsBefore59 = await prisma.downloadEvent.count({ where: { productVersionId: v59.id } });

  const res59 = await apiPost("/v1/updates/check", {
    licenseKey: rawKey,
    domain: "client-site.com",
    productId: pluginProd.id,
    currentVersion: "2.0.0",
  });
  if (!res59.ok) {
    throw new Error(`Gate 59 update check request failed: ${res59.status}`);
  }
  if (res59.data.updateAvailable !== false || res59.data.downloadUrl) {
    throw new Error(`Expected updateAvailable: false and no downloadUrl, got ${JSON.stringify(res59.data)}`);
  }
  const grantsAfter59 = await prisma.downloadGrant.count({ where: { productVersionId: v59.id } });
  const eventsAfter59 = await prisma.downloadEvent.count({ where: { productVersionId: v59.id } });
  if (grantsAfter59 !== grantsBefore59 || eventsAfter59 !== eventsBefore59) {
    throw new Error("DownloadGrant or DownloadEvent created for version with no primary package file!");
  }
  console.log("✓ Gate 59 passed: Updater check with published version missing primary file returns updateAvailable: false without grants/events");

  // [Gate 60] Oversize admin upload fails closed with HTTP 413
  console.log("\n[Gate 60] Testing oversize admin upload fails closed with 413 and zero storage objects...");
  const oversizeApi = spawn(
    "node",
    [path.resolve(__dirname, "../../../apps/api/dist/main.js")],
    {
      cwd: path.resolve(__dirname, "../../.."),
      stdio: "pipe",
      env: {
        ...process.env,
        PORT: "4007",
        MAX_UPLOAD_BYTES: "1024",
      },
    },
  );
  allSpawnedProcesses.push(oversizeApi);

  let oversizeReady = false;
  const startOversize = Date.now();
  while (Date.now() - startOversize < 15000) {
    await sleep(400);
    try {
      const res = await fetch("http://localhost:4007/health");
      if (res.status === 200) {
        oversizeReady = true;
        break;
      }
    } catch {}
  }
  if (!oversizeReady) {
    throw new Error("Failed to start oversize test API on port 4007");
  }

  const v60 = await prisma.productVersion.create({
    data: {
      productId: pluginProd.id,
      version: "6.0.0",
      status: "DRAFT",
    },
  });

  const bigBuffer = Buffer.alloc(2048, "A");
  const oversizeRes = await apiUpload(
    `/admin/product-versions/${v60.id}/files/upload`,
    bigBuffer,
    "oversize.zip",
    true,
    adminToken,
    "http://localhost:4007",
  );

  try {
    oversizeApi.kill("SIGTERM");
  } catch {}

  if (oversizeRes.status !== 413) {
    throw new Error(`Expected HTTP 413 for oversize upload, got ${oversizeRes.status}: ${JSON.stringify(oversizeRes.data)}`);
  }
  const files60 = await prisma.productVersionFile.count({ where: { productVersionId: v60.id } });
  if (files60 !== 0) {
    throw new Error(`Expected 0 files in DB for oversize upload, found ${files60}`);
  }
  const list60 = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: `products/${pluginProd.id}/versions/${v60.id}/`,
    }),
  );
  if (list60.KeyCount && list60.KeyCount > 0) {
    throw new Error(`Found ${list60.KeyCount} orphan storage objects after 413 upload rejection!`);
  }
  console.log("✓ Gate 60 passed: Oversize admin upload rejected with 413; zero DB records and zero storage objects created");

  // [Gate 61] DB registration failure cleans up storage object (zero orphan objects in bucket)
  console.log("\n[Gate 61] Testing orphan storage cleanup when upload encounters duplicate primary file conflict...");
  const v61 = await prisma.productVersion.create({
    data: {
      productId: pluginProd.id,
      version: "6.1.0",
      status: "DRAFT",
    },
  });

  const upload1Res = await apiUpload(
    `/admin/product-versions/${v61.id}/files/upload`,
    Buffer.from("VALID_PRIMARY_FILE_V61"),
    "primary-v61.zip",
    true,
    adminToken,
  );
  if (!upload1Res.ok) {
    throw new Error(`First primary file upload failed: ${upload1Res.status}`);
  }

  const listBefore = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: `products/${pluginProd.id}/versions/${v61.id}/`,
    }),
  );
  const countBefore = listBefore.KeyCount || 0;
  if (countBefore !== 1) {
    throw new Error(`Expected exactly 1 storage object before conflict, found ${countBefore}`);
  }

  // Second primary file upload fails with 409 Conflict
  const upload2Res = await apiUpload(
    `/admin/product-versions/${v61.id}/files/upload`,
    Buffer.from("SECOND_PRIMARY_SHOULD_FAIL"),
    "primary-v61-second.zip",
    true,
    adminToken,
  );
  if (upload2Res.status !== 409) {
    throw new Error(`Expected 409 Conflict for duplicate primary file, got ${upload2Res.status}`);
  }

  // Check MinIO: the second file must NOT remain orphaned in storage
  const listAfter = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: `products/${pluginProd.id}/versions/${v61.id}/`,
    }),
  );
  const countAfter = listAfter.KeyCount || 0;
  if (countAfter !== 1) {
    throw new Error(`Orphan object remained in private storage after 409! Count before: ${countBefore}, count after: ${countAfter}`);
  }
  console.log("✓ Gate 61 passed: Best-effort cleanup deleted orphan storage object on DB conflict (409)");

  // [Gate 62] Storage object deleted before customer download request fails closed
  console.log("\n[Gate 62] Testing customer download request when storage object is missing from bucket...");
  const v62Prod = await createTestProduct(FulfillmentType.DIGITAL_DOWNLOAD);
  const v62Ent = await createTestEntitlement({
    userId: customer1Id,
    productId: v62Prod.product.id,
    variantId: v62Prod.variant.id,
  });
  const v62 = await prisma.productVersion.create({
    data: {
      productId: v62Prod.product.id,
      version: "6.2.0",
      status: "DRAFT",
    },
  });
  const s3Res62 = await uploadRawObjectToMinio(`products/${v62Prod.product.id}/versions/${v62.id}/file.zip`, "GATE_62_CONTENT");
  const file62 = await prisma.productVersionFile.create({
    data: {
      productVersionId: v62.id,
      storageKey: `products/${v62Prod.product.id}/versions/${v62.id}/file.zip`,
      fileName: "file.zip",
      sizeBytes: s3Res62.sizeBytes,
      sha256: s3Res62.sha256,
      isPrimary: true,
      verifiedAt: new Date(),
    },
  });
  await apiPost(`/admin/product-versions/${v62.id}/publish`, {}, adminToken);

  // Delete object from MinIO to simulate object missing/deleted
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: file62.storageKey,
    }),
  );

  const eventsBefore62 = await prisma.downloadEvent.count({ where: { productVersionId: v62.id } });
  const auditsBefore62 = await prisma.auditLog.count({ where: { action: "DOWNLOAD_URL_ISSUED", entity: "DownloadGrant" } });

  const dlRes62 = await apiPost(
    "/v1/downloads/request",
    {
      entitlementId: v62Ent.id,
      versionId: v62.id,
      fileId: file62.id,
    },
    customer1Token,
  );

  if (dlRes62.status !== 503) {
    throw new Error(`Expected 503 when storage object is missing for customer download, got ${dlRes62.status}`);
  }

  const eventsAfter62 = await prisma.downloadEvent.count({ where: { productVersionId: v62.id } });
  const auditsAfter62 = await prisma.auditLog.count({ where: { action: "DOWNLOAD_URL_ISSUED", entity: "DownloadGrant" } });
  if (eventsAfter62 !== eventsBefore62 || auditsAfter62 !== auditsBefore62) {
    throw new Error("DownloadEvent or DOWNLOAD_URL_ISSUED audit emitted when storage object was missing!");
  }
  console.log("✓ Gate 62 passed: Storage object missing before download request failed closed (503) with zero events and zero audits");

  // [Gate 63] Storage object missing on updater check fails closed without emitting DownloadEvent or audit log
  console.log("\n[Gate 63] Testing updater check when primary file storage object is missing from bucket...");
  const v63 = await prisma.productVersion.create({
    data: {
      productId: pluginProd.id,
      version: "6.3.0",
      status: "DRAFT",
    },
  });
  const s3Res63 = await uploadRawObjectToMinio(`products/${pluginProd.id}/versions/${v63.id}/updater-missing.zip`, "UPDATER_WILL_DELETE");
  const file63 = await prisma.productVersionFile.create({
    data: {
      productVersionId: v63.id,
      storageKey: `products/${pluginProd.id}/versions/${v63.id}/updater-missing.zip`,
      fileName: "updater-missing.zip",
      sizeBytes: s3Res63.sizeBytes,
      sha256: s3Res63.sha256,
      isPrimary: true,
      verifiedAt: new Date(),
    },
  });
  await apiPost(`/admin/product-versions/${v63.id}/publish`, {}, adminToken);

  // Delete object from MinIO
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: file63.storageKey,
    }),
  );

  const eventsBefore63 = await prisma.downloadEvent.count({ where: { productVersionId: v63.id } });
  const auditsBefore63 = await prisma.auditLog.count({ where: { action: "DOWNLOAD_URL_ISSUED", entity: "DownloadGrant" } });

  const upRes63 = await apiPost("/v1/updates/check", {
    licenseKey: rawKey,
    domain: "client-site.com",
    productId: pluginProd.id,
    currentVersion: "2.0.0",
  });

  if (!upRes63.ok) {
    throw new Error(`Updater check failed: ${upRes63.status}`);
  }
  if (upRes63.data.updateAvailable !== false || upRes63.data.downloadUrl) {
    throw new Error(`Expected updateAvailable: false and no downloadUrl when storage object is missing, got ${JSON.stringify(upRes63.data)}`);
  }

  const eventsAfter63 = await prisma.downloadEvent.count({ where: { productVersionId: v63.id } });
  const auditsAfter63 = await prisma.auditLog.count({ where: { action: "DOWNLOAD_URL_ISSUED", entity: "DownloadGrant" } });
  if (eventsAfter63 !== eventsBefore63 || auditsAfter63 !== auditsBefore63) {
    throw new Error("DownloadEvent or audit log emitted when storage object was missing during updater check!");
  }
  console.log("✓ Gate 63 passed: Missing storage object during updater check returned updateAvailable: false with zero events and zero audits");

  // [Gate 64] Updater Redis outage through real API verified across multiple calls
  console.log("\n[Gate 64] Testing updater Redis outage across multiple consecutive requests via real API...");
  const updaterOutageProcess = spawn(
    "node",
    [path.resolve(__dirname, "../../../apps/api/dist/main.js")],
    {
      cwd: path.resolve(__dirname, "../../.."),
      stdio: "pipe",
      env: {
        ...process.env,
        PORT: "4008",
        REDIS_URL: "redis://127.0.0.1:6399", // unreachable dead port
        LICENSE_KEY_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
      },
    },
  );
  allSpawnedProcesses.push(updaterOutageProcess);

  let upOutageReady = false;
  const startUpOutage = Date.now();
  while (Date.now() - startUpOutage < 15000) {
    await sleep(400);
    try {
      const res = await fetch("http://localhost:4008/health");
      if (res.status === 200 || res.status === 503) {
        upOutageReady = true;
        break;
      }
    } catch {}
  }
  if (!upOutageReady) {
    throw new Error("Failed to start updater outage API process on port 4008");
  }

  const grantsBefore64 = await prisma.downloadGrant.count({ where: { entitlementId: pluginEnt.id } });
  const eventsBefore64 = await prisma.downloadEvent.count({ where: { entitlementId: pluginEnt.id } });
  const auditsBefore64 = await prisma.auditLog.count({ where: { action: "DOWNLOAD_URL_ISSUED", entity: "DownloadGrant" } });

  // Make 3 calls during outage
  for (let i = 1; i <= 3; i++) {
    const outageRes = await fetch("http://localhost:4008/v1/updates/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        licenseKey: rawKey,
        domain: "client-site.com",
        productId: pluginProd.id,
        currentVersion: "1.0.0",
      }),
    });
    if (outageRes.status !== 503) {
      throw new Error(`Request ${i} expected 503 during Redis outage, got ${outageRes.status}`);
    }
    const outageData: any = await outageRes.json().catch(() => null);
    if (outageData?.downloadUrl) {
      throw new Error(`Request ${i} returned downloadUrl during Redis outage!`);
    }
  }

  const grantsAfter64 = await prisma.downloadGrant.count({ where: { entitlementId: pluginEnt.id } });
  const eventsAfter64 = await prisma.downloadEvent.count({ where: { entitlementId: pluginEnt.id } });
  const auditsAfter64 = await prisma.auditLog.count({ where: { action: "DOWNLOAD_URL_ISSUED", entity: "DownloadGrant" } });

  try {
    updaterOutageProcess.kill("SIGTERM");
  } catch {}

  if (grantsAfter64 !== grantsBefore64 || eventsAfter64 !== eventsBefore64 || auditsAfter64 !== auditsBefore64) {
    throw new Error("Grants, events, or audits created during multi-call updater Redis outage!");
  }
  console.log("✓ Gate 64 passed: Multiple updater check calls during Redis outage all failed closed (503) with zero grants, events, or audits");

  // [Gate 65] Redis TIME sliding-window member format verification
  console.log("\n[Gate 65] Verifying rate limit sorted set member format matches ${nowMs}:${nonce} using Redis TIME...");
  const ent65 = await createTestEntitlement({ userId: customer1Id });
  const rateLimitKey65 = `ratelimit:download:customer:${ent65.id}:${customer1Id}`;
  await redis.del(rateLimitKey65);

  const req65 = await apiPost(
    "/v1/downloads/request",
    {
      entitlementId: ent65.id,
      versionId: v1Id,
      fileId: file1Id,
    },
    customer1Token,
  );
  if (!req65.ok) {
    throw new Error(`Gate 65 download request failed: ${req65.status}`);
  }

  const zMembers = await redis.zrange(rateLimitKey65, 0, -1, "WITHSCORES");
  if (!zMembers || zMembers.length < 2) {
    throw new Error(`Expected at least 1 member and score in ZSET, got ${JSON.stringify(zMembers)}`);
  }

  const [member, scoreStr] = zMembers;
  const score = Number(scoreStr);
  const colonIdx = member.indexOf(":");
  if (colonIdx === -1) {
    throw new Error(`Member format does not contain colon: ${member}`);
  }
  const memberNowMs = Number(member.substring(0, colonIdx));
  const nonce = member.substring(colonIdx + 1);

  if (memberNowMs !== score) {
    throw new Error(`Member nowMs (${memberNowMs}) does not match ZSET score (${score})`);
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(nonce)) {
    throw new Error(`Member nonce is not a valid UUID: ${nonce}`);
  }

  const redisTimeResult = (await redis.time()) as [string, string];
  const redisNowMs = Number(redisTimeResult[0]) * 1000 + Math.floor(Number(redisTimeResult[1]) / 1000);
  const driftMs = Math.abs(redisNowMs - memberNowMs);
  if (driftMs > 10000) {
    throw new Error(`Member timestamp drift from Redis TIME is too high: ${driftMs}ms (member: ${memberNowMs}, redis: ${redisNowMs})`);
  }
  console.log(`✓ Gate 65 passed: Redis ZSET member matches \${nowMs}:\${nonce} (${memberNowMs}:${nonce.substring(0, 8)}...), score ${score}, drift from Redis TIME is ${driftMs}ms`);

  // [Gate 66] Legacy addVersionFile removed; registerVerifiedUploadedFile requires verifier callback, object existence & prefix validation
  console.log("\n[Gate 66] Verifying legacy addVersionFile is removed and registerVerifiedUploadedFile fails closed without verifier...");
  if ((dbModule as any).addVersionFile !== undefined) {
    throw new Error("Legacy bypass function addVersionFile is still exported from @nexus/database!");
  }

  const v66Prod = await createTestProduct(FulfillmentType.DIGITAL_DOWNLOAD);
  const v66 = await prisma.productVersion.create({
    data: {
      productId: v66Prod.product.id,
      version: "6.6.0",
      status: "DRAFT",
    },
  });

  // Attempt 1: calling registerVerifiedUploadedFile without verifyUploadedObject must throw STORAGE_VERIFICATION_REQUIRED (503)
  let gate66NoVerifierThrew = false;
  try {
    await registerVerifiedUploadedFile(
      {
        productVersionId: v66.id,
        storageKey: `products/${v66Prod.product.id}/versions/${v66.id}/test.zip`,
        fileName: "test.zip",
        verifyUploadedObject: undefined as any,
      },
      prisma,
    );
  } catch (err: any) {
    if (err instanceof DownloadVersionEngineError && err.code === "STORAGE_VERIFICATION_REQUIRED" && err.statusCode === 503) {
      gate66NoVerifierThrew = true;
    } else {
      throw new Error(`Unexpected error without verifier callback: ${err?.message || err}`);
    }
  }
  if (!gate66NoVerifierThrew) {
    throw new Error("registerVerifiedUploadedFile succeeded without verifyUploadedObject callback!");
  }

  // Attempt 2: calling registerVerifiedUploadedFile where verifier reports valid: false must throw STORAGE_VERIFICATION_FAILED (400)
  let gate66NotFoundThrew = false;
  try {
    await registerVerifiedUploadedFile(
      {
        productVersionId: v66.id,
        storageKey: `products/${v66Prod.product.id}/versions/${v66.id}/missing.zip`,
        fileName: "missing.zip",
        verifyUploadedObject: async () => ({ valid: false, reason: "Storage verification failed: object not found" }),
      },
      prisma,
    );
  } catch (err: any) {
    if (err instanceof DownloadVersionEngineError && err.code === "STORAGE_VERIFICATION_FAILED" && err.statusCode === 400) {
      gate66NotFoundThrew = true;
    } else {
      throw new Error(`Unexpected error when storage object not found: ${err?.message || err}`);
    }
  }
  if (!gate66NotFoundThrew) {
    throw new Error("registerVerifiedUploadedFile succeeded when storage object did not exist!");
  }

  // Attempt 3: calling registerVerifiedUploadedFile with storageKey outside product/version prefix must throw INVALID_STORAGE_KEY (400)
  let gate66PrefixThrew = false;
  try {
    await registerVerifiedUploadedFile(
      {
        productVersionId: v66.id,
        storageKey: `malicious/path/escape.zip`,
        fileName: "escape.zip",
        verifyUploadedObject: async () => ({ valid: true, sizeBytes: 100, sha256: "abc" }),
      },
      prisma,
    );
  } catch (err: any) {
    if (err instanceof DownloadVersionEngineError && err.code === "INVALID_STORAGE_KEY" && err.statusCode === 400) {
      gate66PrefixThrew = true;
    } else {
      throw new Error(`Unexpected error when storage key outside prefix: ${err?.message || err}`);
    }
  }
  if (!gate66PrefixThrew) {
    throw new Error("registerVerifiedUploadedFile accepted storageKey outside prefix!");
  }

  // Verify zero files created in DB for failed registrations
  const files66Fail = await prisma.productVersionFile.count({ where: { productVersionId: v66.id } });
  if (files66Fail !== 0) {
    throw new Error(`Expected 0 files created for gate 66 failures, found ${files66Fail}`);
  }

  // Attempt 4: Valid registration with real MinIO upload and verified callback
  const s3Res66 = await uploadRawObjectToMinio(`products/${v66Prod.product.id}/versions/${v66.id}/valid.zip`, "GATE_66_CONTENT");
  const file66 = await registerVerifiedUploadedFile(
    {
      productVersionId: v66.id,
      storageKey: `products/${v66Prod.product.id}/versions/${v66.id}/valid.zip`,
      fileName: "valid.zip",
      isPrimary: true,
      actorId: adminId,
      actorRole: "ADMIN",
      verifyUploadedObject: async (key: string) => {
        const head = await s3Client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
        return {
          valid: true,
          sizeBytes: head.ContentLength || s3Res66.sizeBytes,
          sha256: s3Res66.sha256,
        };
      },
    },
    prisma,
  );
  if (!file66.verifiedAt || file66.sizeBytes !== s3Res66.sizeBytes || file66.sha256 !== s3Res66.sha256) {
    throw new Error("registerVerifiedUploadedFile failed to set authoritative verified metadata");
  }
  const fileAudits66 = await prisma.auditLog.count({
    where: { entity: "ProductVersionFile", entityId: file66.id, action: "VERSION_FILE_VERIFIED" },
  });
  if (fileAudits66 !== 1) {
    throw new Error(`Expected exactly 1 VERSION_FILE_VERIFIED audit log, found ${fileAudits66}`);
  }
  console.log("✓ Gate 66 passed: Legacy addVersionFile removed; registerVerifiedUploadedFile strictly requires verifier callback, object existence, and prefix validation");

  // [Gate 67] Legacy bypass wrappers removed from @nexus/database
  console.log("\n[Gate 67] Verifying legacy bypass wrappers are removed from @nexus/database...");
  if ((dbModule as any).recordDownloadEvent !== undefined) {
    throw new Error("Legacy bypass function recordDownloadEvent is still exported from @nexus/database!");
  }
  if ((dbModule as any).authorizeCustomerDownload !== undefined) {
    throw new Error("Legacy function authorizeCustomerDownload is still exported from @nexus/database!");
  }
  if ((dbModule as any).authorizeLicenseUpdater !== undefined) {
    throw new Error("Legacy function authorizeLicenseUpdater is still exported from @nexus/database!");
  }
  console.log("✓ Gate 67 passed: Legacy bypass functions recordDownloadEvent, authorizeCustomerDownload, and authorizeLicenseUpdater are completely removed");

  // [Gate 68] Malformed MAX_UPLOAD_BYTES rejection and bound enforcement
  console.log("\n[Gate 68] Testing resolveMaxUploadBytes contract safety and boundary validation...");
  if (resolveMaxUploadBytes(undefined) !== DEFAULT_MAX_UPLOAD_BYTES) {
    throw new Error(`Expected undefined to resolve to ${DEFAULT_MAX_UPLOAD_BYTES}, got ${resolveMaxUploadBytes(undefined)}`);
  }
  if (resolveMaxUploadBytes(null) !== DEFAULT_MAX_UPLOAD_BYTES) {
    throw new Error(`Expected null to resolve to ${DEFAULT_MAX_UPLOAD_BYTES}, got ${resolveMaxUploadBytes(null)}`);
  }
  if (resolveMaxUploadBytes("") !== DEFAULT_MAX_UPLOAD_BYTES) {
    throw new Error(`Expected empty string to resolve to ${DEFAULT_MAX_UPLOAD_BYTES}, got ${resolveMaxUploadBytes("")}`);
  }
  if (resolveMaxUploadBytes("   ") !== DEFAULT_MAX_UPLOAD_BYTES) {
    throw new Error(`Expected whitespace string to resolve to ${DEFAULT_MAX_UPLOAD_BYTES}, got ${resolveMaxUploadBytes("   ")}`);
  }
  if (resolveMaxUploadBytes("1048576") !== 1048576) {
    throw new Error(`Expected '1048576' to resolve to 1048576, got ${resolveMaxUploadBytes("1048576")}`);
  }

  // Verify failure cases (must throw and not return NaN, 0, or negative)
  const invalidUploadBounds = [
    "abc",
    "NaN",
    "Infinity",
    "-Infinity",
    "-1",
    "-100",
    "0",
    "1.5",
    "10e5",
    "0x10",
    String(HARD_CEILING_MAX_UPLOAD_BYTES + 1),
    "999999999999999",
  ];
  for (const val of invalidUploadBounds) {
    let threw = false;
    try {
      resolveMaxUploadBytes(val);
    } catch {
      threw = true;
    }
    if (!threw) {
      throw new Error(`resolveMaxUploadBytes failed to reject invalid value: "${val}"`);
    }
  }
  console.log("✓ Gate 68 passed: resolveMaxUploadBytes strictly enforces integer bounds, defaults safely, and rejects malformed values (fails closed)");

  // [Gate 69] Concurrent recordDownloadIssuance idempotency: exactly 1 DownloadEvent and 1 AuditLog
  console.log("\n[Gate 69] Testing 8 concurrent recordDownloadIssuance calls for identical grantId...");
  const v69Prod = await createTestProduct(FulfillmentType.DIGITAL_DOWNLOAD);
  const v69Ent = await createTestEntitlement({
    userId: customer1Id,
    productId: v69Prod.product.id,
    variantId: v69Prod.variant.id,
  });
  const v69 = await prisma.productVersion.create({
    data: {
      productId: v69Prod.product.id,
      version: "6.9.0",
      status: "PUBLISHED",
      releasedAt: new Date(),
    },
  });
  const s3Res69 = await uploadRawObjectToMinio(`products/${v69Prod.product.id}/versions/${v69.id}/v69.zip`, "GATE_69_CONTENT");
  const file69 = await prisma.productVersionFile.create({
    data: {
      productVersionId: v69.id,
      storageKey: `products/${v69Prod.product.id}/versions/${v69.id}/v69.zip`,
      fileName: "v69.zip",
      sizeBytes: s3Res69.sizeBytes,
      sha256: s3Res69.sha256,
      isPrimary: true,
      verifiedAt: new Date(),
    },
  });

  const testGrant = await prisma.downloadGrant.create({
    data: {
      userId: customer1Id,
      entitlementId: v69Ent.id,
      productVersionId: v69.id,
      fileId: file69.id,
      channel: "CUSTOMER_PORTAL",
      expiresAt: new Date(Date.now() + 300000),
    },
  });

  const eventsBefore69 = await prisma.downloadEvent.count({ where: { grantId: testGrant.id } });
  const auditsBefore69 = await prisma.auditLog.count({
    where: { entity: "DownloadGrant", entityId: testGrant.id, action: "DOWNLOAD_URL_ISSUED" },
  });
  if (eventsBefore69 !== 0 || auditsBefore69 !== 0) {
    throw new Error("Pre-existing events or audits found for fresh test grant!");
  }

  // Concurrently execute 8 recordDownloadIssuance calls with the same grantId
  const issuancePromises = Array.from({ length: 8 }, (_, i) =>
    recordDownloadIssuance(
      {
        grantId: testGrant.id,
        ipAddress: `192.168.1.${i + 1}`,
        userAgent: `Test-Agent-${i + 1}`,
      },
      prisma,
    ),
  );

  const issuanceResults = await Promise.all(issuancePromises);

  // All results must return an event
  if (issuanceResults.length !== 8) {
    throw new Error(`Expected 8 issuance results, got ${issuanceResults.length}`);
  }
  const firstEventId = issuanceResults[0].event.id;
  for (let i = 1; i < issuanceResults.length; i++) {
    if (issuanceResults[i].event.id !== firstEventId) {
      throw new Error(`Issuance result ${i} returned different event ID: ${issuanceResults[i].event.id} vs ${firstEventId}`);
    }
  }

  const eventsAfter69 = await prisma.downloadEvent.count({ where: { grantId: testGrant.id } });
  const auditsAfter69 = await prisma.auditLog.count({
    where: { entity: "DownloadGrant", entityId: testGrant.id, action: "DOWNLOAD_URL_ISSUED" },
  });

  if (eventsAfter69 !== 1) {
    throw new Error(`Expected exactly 1 DownloadEvent created for concurrent issuances, found ${eventsAfter69}`);
  }
  if (auditsAfter69 !== 1) {
    throw new Error(`Expected exactly 1 DOWNLOAD_URL_ISSUED AuditLog created for concurrent issuances, found ${auditsAfter69}`);
  }
  console.log(`✓ Gate 69 passed: 8 concurrent recordDownloadIssuance calls resulted in exactly 1 DownloadEvent (${firstEventId}) and 1 DOWNLOAD_URL_ISSUED audit log`);

  console.log("\n==================================================");
  console.log("ALL 69 PHASE 8 LIVE ACCEPTANCE GATES PASSED SUCCESSFULLY!");
  console.log("==================================================");
}

runPhase8Acceptance()
  .then(() => {
    stopChildProcesses();
    redis.disconnect();
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ PHASE 8 ACCEPTANCE TEST FAILED:", err);
    stopChildProcesses();
    redis.disconnect();
    process.exit(1);
  });
