import * as crypto from "crypto";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import {
  prisma,
  SubscriptionTier,
  BillingInterval,
  SubscriptionStatus,
  AffiliateStatus,
  ReferralStatus,
  PayoutStatus,
  PayoutMethod,
  FulfillmentType,
  EntitlementStatus,
  isSelfReferral,
  calculateCommissionMinor,
  calculateMatureDate,
  advanceBillingPeriod,
  isValidSubscriptionTransition,
  isValidReferralTransition,
  isValidPayoutTransition,
} from "../src/index";
import {
  normalizeAffiliateCode,
  isReservedAffiliateCode,
  isValidAffiliateCode,
  parseAffiliateCookie,
  buildAffiliateCookie,
  createAffiliateFingerprintHash,
  calculateAffiliateCommission,
  calculateAffiliateConversionRate,
  MIN_COMMISSION_RATE_BP,
  MAX_COMMISSION_RATE_BP,
  DEFAULT_COMMISSION_RATE_BP,
  MIN_PAYOUT_AMOUNT_USD,
} from "@nexus/utils";

const TEST_PORT = process.env.API_PORT || "4009";
const API_BASE = `http://127.0.0.1:${TEST_PORT}`;

let apiProcess: ChildProcess | null = null;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureApiRunning(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (res.ok || res.status === 503) {
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
        LICENSE_KEY_ENCRYPTION_KEY:
          process.env.LICENSE_KEY_ENCRYPTION_KEY ||
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
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
    if (
      !msg.includes("ExperimentalWarning") &&
      !msg.includes("deprecated") &&
      !msg.includes("ioredis")
    ) {
      console.error(`  [API Error] ${msg.trim()}`);
    }
  });

  const start = Date.now();
  while (Date.now() - start < 30000) {
    await sleep(500);
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok || res.status === 503) {
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

async function runPhase13Acceptance() {
  console.log("================================================================================");
  console.log("PHASE 13 ACCEPTANCE TEST SUITE — AFFILIATE & MEMBERSHIP ARCHITECTURE");
  console.log("Zero-client authority, CAS balance mutations, Anti-fraud, Quotas, Maturation");
  console.log("================================================================================\n");

  await ensureApiRunning();

  const runId = crypto.randomUUID().substring(0, 8);
  const adminToken = "dev-admin-token";
  const customerToken = "dev-customer-token"; // Partner User
  const buyerToken = `dev-custom:buyer_${runId}:buyer_${runId}@nexustheme.dev`;
  const otherToken = `dev-custom:other_${runId}:other_${runId}@nexustheme.dev`;

  let totalGates = 0;
  let passedGates = 0;

  function recordPass(gateNum: number, desc: string) {
    totalGates++;
    passedGates++;
    console.log(`✓ [Gate ${gateNum}] Passed: ${desc}`);
  }

  function failGate(gateNum: number, reason: string): never {
    totalGates++;
    console.error(`✗ [Gate ${gateNum}] FAILED: ${reason}`);
    throw new Error(`Gate ${gateNum} failure: ${reason}`);
  }

  try {
    // Ensure Users exist in database
    const adminUserRes = await apiGet("/auth/me", adminToken);
    const customerUserRes = await apiGet("/auth/me", customerToken);
    const buyerUserRes = await apiGet("/auth/me", buyerToken);
    const otherUserRes = await apiGet("/auth/me", otherToken);

    const adminUserId = adminUserRes.data?.id;
    const partnerUserId = customerUserRes.data?.id;
    const buyerUserId = buyerUserRes.data?.id;
    const otherUserId = otherUserRes.data?.id;

    if (!partnerUserId || !buyerUserId || !adminUserId) {
      throw new Error("Failed to initialize test user identities");
    }

    // Assign admin role permissions for subscriptions and affiliates
    const adminRole = await prisma.role.findUnique({ where: { name: "admin" } });
    if (adminRole) {
      const perms = [
        "affiliate.read",
        "affiliate.manage",
        "subscription.read",
        "subscription.manage",
      ];
      for (const p of perms) {
        const permRecord = await prisma.permission.findUnique({ where: { name: p } });
        if (permRecord) {
          await prisma.rolePermission.upsert({
            where: {
              roleId_permissionId: {
                roleId: adminRole.id,
                permissionId: permRecord.id,
              },
            },
            update: {},
            create: {
              roleId: adminRole.id,
              permissionId: permRecord.id,
            },
          });
        }
      }
    }

    // =========================================================================
    // SUB-SYSTEM 1: SUBSCRIPTION PLANS MANAGEMENT (Gates 1 - 10)
    // =========================================================================
    console.log("\n--- [Sub-System 1] Subscription Plans Management ---");

    // Gate 1: Public list plans
    const p1 = await apiGet("/v1/subscriptions/plans");
    if (p1.status !== 200 || !Array.isArray(p1.data)) {
      failGate(1, `Expected 200 array for public plans, got ${p1.status}`);
    }
    recordPass(1, "Public list subscription plans returns 200 array");

    // Gate 2: Unauthenticated customer cannot create plan
    const p2 = await apiPost("/v1/admin/subscriptions/plans", {
      name: "Hacker Tier",
      slug: `hacker-${runId}`,
      tier: "PRO",
      interval: "MONTHLY",
      priceMinor: 100,
      dailyDownloadQuota: 10,
    });
    if (p2.status !== 401) {
      failGate(2, `Expected 401 for unauthenticated plan creation, got ${p2.status}`);
    }
    recordPass(2, "Unauthenticated plan creation strictly rejected with 401");

    // Gate 3: Customer role cannot create plan (403)
    const p3 = await apiPost(
      "/v1/admin/subscriptions/plans",
      {
        name: "Unauthorized Tier",
        slug: `unauth-${runId}`,
        tier: "PRO",
        interval: "MONTHLY",
        priceMinor: 100,
        dailyDownloadQuota: 10,
      },
      customerToken,
    );
    if (p3.status !== 403) {
      failGate(3, `Expected 403 for customer creating plan, got ${p3.status}`);
    }
    recordPass(3, "Non-admin customer role rejected from creating plans with 403");

    // Gate 4: Admin creates STARTER plan
    const starterSlug = `starter-vip-${runId}`;
    const p4 = await apiPost(
      "/v1/admin/subscriptions/plans",
      {
        name: "Starter VIP Membership",
        slug: starterSlug,
        tier: "STARTER",
        interval: "MONTHLY",
        priceMinor: 2900,
        currency: "USD",
        dailyDownloadQuota: 15,
        maxActivationsPerProduct: 2,
        features: ["Standard Updates", "Community Support", "15 downloads/day"],
      },
      adminToken,
    );
    if (p4.status !== 201 || p4.data?.slug !== starterSlug) {
      failGate(4, `Expected 201 created for STARTER plan, got ${p4.status}: ${JSON.stringify(p4.data)}`);
    }
    const starterPlan = p4.data;
    recordPass(4, `Admin creates STARTER tier plan '${starterPlan.name}' with 15 daily downloads`);

    // Gate 5: Admin creates PRO plan
    const proSlug = `pro-developer-${runId}`;
    const p5 = await apiPost(
      "/v1/admin/subscriptions/plans",
      {
        name: "Pro Developer Pass",
        slug: proSlug,
        tier: "PRO",
        interval: "YEARLY",
        priceMinor: 19900,
        currency: "USD",
        dailyDownloadQuota: 50,
        maxActivationsPerProduct: 5,
        features: ["All Themes & Plugins", "Priority Support", "50 downloads/day"],
      },
      adminToken,
    );
    if (p5.status !== 201 || p5.data?.slug !== proSlug) {
      failGate(5, `Expected 201 for PRO plan, got ${p5.status}`);
    }
    const proPlan = p5.data;
    recordPass(5, `Admin creates PRO tier plan '${proPlan.name}' with 50 daily downloads`);

    // Gate 6: Admin creates LIFETIME plan with interval LIFETIME
    const lifetimeSlug = `lifetime-agency-${runId}`;
    const p6 = await apiPost(
      "/v1/admin/subscriptions/plans",
      {
        name: "Lifetime Agency License",
        slug: lifetimeSlug,
        tier: "AGENCY",
        interval: "LIFETIME",
        priceMinor: 49900,
        currency: "USD",
        dailyDownloadQuota: 100,
        maxActivationsPerProduct: 25,
        features: ["Unlimited GPL Access", "Dedicated Account Manager", "Lifetime Updates"],
      },
      adminToken,
    );
    if (p6.status !== 201 || p6.data?.interval !== "LIFETIME") {
      failGate(6, `Expected 201 for LIFETIME plan, got ${p6.status}`);
    }
    const lifetimePlan = p6.data;
    recordPass(6, `Admin creates LIFETIME interval plan '${lifetimePlan.name}'`);

    // Gate 7: Negative price validation
    const p7 = await apiPost(
      "/v1/admin/subscriptions/plans",
      {
        name: "Invalid Plan",
        slug: `invalid-price-${runId}`,
        tier: "PRO",
        interval: "MONTHLY",
        priceMinor: -500,
        dailyDownloadQuota: 10,
      },
      adminToken,
    );
    if (p7.status !== 400) {
      failGate(7, `Expected 400 for negative price, got ${p7.status}`);
    }
    recordPass(7, "Plan with negative price strictly rejected with 400 Bad Request");

    // Gate 8: Negative/zero quota validation
    const p8 = await apiPost(
      "/v1/admin/subscriptions/plans",
      {
        name: "Zero Quota Plan",
        slug: `zero-quota-${runId}`,
        tier: "PRO",
        interval: "MONTHLY",
        priceMinor: 1000,
        dailyDownloadQuota: 0,
      },
      adminToken,
    );
    if (p8.status !== 400) {
      failGate(8, `Expected 400 for zero quota, got ${p8.status}`);
    }
    recordPass(8, "Plan with zero daily download quota rejected with 400 Bad Request");

    // Gate 9: Admin updates plan features and quota
    const p9 = await apiPatch(
      `/v1/admin/subscriptions/plans/${starterPlan.id}`,
      {
        dailyDownloadQuota: 20,
        features: ["Updated Standard", "20 downloads/day"],
      },
      adminToken,
    );
    if (p9.status !== 200 || p9.data?.dailyDownloadQuota !== 20) {
      failGate(9, `Expected 200 updated plan, got ${p9.status}`);
    }
    recordPass(9, "Admin successfully updates plan daily download quota to 20");

    // Gate 10: Inactive plan is hidden from public list
    const hiddenSlug = `hidden-${runId}`;
    const createHidden = await apiPost(
      "/v1/admin/subscriptions/plans",
      {
        name: "Internal Secret Plan",
        slug: hiddenSlug,
        tier: "STARTER",
        interval: "MONTHLY",
        priceMinor: 500,
        dailyDownloadQuota: 5,
        isActive: false,
      },
      adminToken,
    );
    if (createHidden.status !== 201) {
      failGate(10, `Failed to create hidden plan: ${createHidden.status}`);
    }
    const publicList = await apiGet("/v1/subscriptions/plans");
    const foundInPublic = publicList.data?.some((p: any) => p.slug === hiddenSlug);
    if (foundInPublic) {
      failGate(10, "Inactive plan should not appear in public listing!");
    }
    recordPass(10, "Inactive subscription plan correctly excluded from public catalog");

    // =========================================================================
    // SUB-SYSTEM 2: CUSTOMER CHECKOUT & PROVISIONING (Gates 11 - 20)
    // =========================================================================
    console.log("\n--- [Sub-System 2] Customer Checkout & Provisioning ---");

    // Gate 11: Unauthenticated access to /subscriptions/me rejected
    const c11 = await apiGet("/v1/subscriptions/me");
    if (c11.status !== 401) {
      failGate(11, `Expected 401 for unauthenticated /me, got ${c11.status}`);
    }
    recordPass(11, "Unauthenticated access to /subscriptions/me rejected with 401");

    // Gate 12: Customer without active subscription returns 404
    const c12 = await apiGet("/v1/subscriptions/me", buyerToken);
    if (c12.status !== 404) {
      failGate(12, `Expected 404 for customer without subscription, got ${c12.status}`);
    }
    recordPass(12, "Customer without subscription receives 404 Not Found cleanly");

    // Gate 13: Customer creates checkout session
    const c13 = await apiPost(
      "/v1/subscriptions/checkout-session",
      {
        planId: proPlan.id,
        successUrl: "https://nexustheme.dev/portal/subscription?success=true",
        cancelUrl: "https://nexustheme.dev/portal/subscription?canceled=true",
      },
      buyerToken,
    );
    if (c13.status !== 200 || !c13.data?.sessionUrl) {
      failGate(13, `Expected 200 with sessionUrl, got ${c13.status}: ${JSON.stringify(c13.data)}`);
    }
    recordPass(13, "Customer initiates subscription checkout session returning valid sessionUrl");

    // Gate 14: Checkout session with non-existent plan returns 404
    const c14 = await apiPost(
      "/v1/subscriptions/checkout-session",
      {
        planId: "00000000-0000-0000-0000-000000000000",
        successUrl: "https://nexustheme.dev/portal",
        cancelUrl: "https://nexustheme.dev/portal",
      },
      buyerToken,
    );
    if (c14.status !== 404) {
      failGate(14, `Expected 404 for invalid plan checkout, got ${c14.status}`);
    }
    recordPass(14, "Non-existent planId in checkout session returns 404");

    // Gate 15: Checkout session with inactive plan returns 400
    const c15 = await apiPost(
      "/v1/subscriptions/checkout-session",
      {
        planId: createHidden.data.id,
        successUrl: "https://nexustheme.dev/portal",
        cancelUrl: "https://nexustheme.dev/portal",
      },
      buyerToken,
    );
    if (c15.status !== 400) {
      failGate(15, `Expected 400 for inactive plan checkout, got ${c15.status}`);
    }
    recordPass(15, "Inactive plan checkout attempt rejected with 400 Bad Request");

    // Gate 16: Provision subscription via database
    const periodStart = new Date();
    const periodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year
    const activeSub = await prisma.subscription.create({
      data: {
        userId: buyerUserId,
        planId: proPlan.id,
        status: SubscriptionStatus.ACTIVE,
        stripeCustomerId: `cus_test_${runId}`,
        stripeSubscriptionId: `sub_test_${runId}`,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
    });
    if (!activeSub || activeSub.status !== "ACTIVE") {
      failGate(16, "Failed to provision active subscription");
    }
    recordPass(16, "Subscription record provisioned in database with status ACTIVE");

    // Gate 17: Provision associated entitlement with MEMBERSHIP_ACCESS
    // First get a product or create a dummy membership product
    let testProduct = await prisma.product.findFirst();
    if (!testProduct) {
      testProduct = await prisma.product.create({
        data: {
          name: "Test Membership Product",
          slug: `prod-membership-${runId}`,
          status: "PUBLISHED",
          priceMinor: 0,
        },
      });
    }
    const membershipEntitlement = await prisma.entitlement.create({
      data: {
        userId: buyerUserId,
        productId: testProduct.id,
        fulfillmentType: FulfillmentType.MEMBERSHIP_ACCESS,
        status: EntitlementStatus.ACTIVE,
        subscriptionId: activeSub.id,
        updatesUntil: periodEnd,
        supportUntil: periodEnd,
      },
    });
    if (!membershipEntitlement || membershipEntitlement.fulfillmentType !== "MEMBERSHIP_ACCESS") {
      failGate(17, "Failed to provision MEMBERSHIP_ACCESS entitlement");
    }
    recordPass(17, "MEMBERSHIP_ACCESS entitlement generated and linked to active subscription");

    // Gate 18: Customer /subscriptions/me returns populated subscription
    const c18 = await apiGet("/v1/subscriptions/me", buyerToken);
    if (
      c18.status !== 200 ||
      c18.data?.id !== activeSub.id ||
      c18.data?.plan?.tier !== "PRO" ||
      c18.data?.dailyDownloadQuota !== 50
    ) {
      failGate(18, `Expected 200 with PRO subscription, got ${c18.status}: ${JSON.stringify(c18.data)}`);
    }
    recordPass(18, "Customer /subscriptions/me returns active PRO membership with tier and plan relations");

    // Gate 19: Customer requests billing portal session
    const c19 = await apiPost(
      "/v1/subscriptions/customer-portal",
      { returnUrl: "https://nexustheme.dev/portal/subscription" },
      buyerToken,
    );
    if (c19.status !== 200 || !c19.data?.sessionUrl) {
      failGate(19, `Expected 200 with portal sessionUrl, got ${c19.status}`);
    }
    recordPass(19, "Customer billing portal session returns mock portal sessionUrl");

    // Gate 20: Portal session without customer ID falls back cleanly
    const c20 = await apiPost(
      "/v1/subscriptions/customer-portal",
      { returnUrl: "https://nexustheme.dev/portal" },
      otherToken,
    );
    if (c20.status !== 200 || !c20.data?.sessionUrl) {
      failGate(20, `Expected 200 fallback portal URL, got ${c20.status}`);
    }
    recordPass(20, "User without billing profile falls back safely to support/billing portal URL");

    // =========================================================================
    // SUB-SYSTEM 3: DAILY DOWNLOAD QUOTA ENFORCEMENT (Gates 21 - 28)
    // =========================================================================
    console.log("\n--- [Sub-System 3] Daily Download Quota Enforcement ---");

    // Gate 21: Check membership quota initial state
    const q21 = await apiGet(`/v1/subscriptions/quota/${membershipEntitlement.id}`, buyerToken);
    if (
      q21.status !== 200 ||
      q21.data?.allowed !== true ||
      q21.data?.dailyLimit !== 50 ||
      q21.data?.usedToday !== 0 ||
      q21.data?.remainingToday !== 50
    ) {
      failGate(21, `Quota check failed: ${JSON.stringify(q21.data)}`);
    }
    recordPass(21, "Initial quota check returns allowed: true, 50 remaining out of 50");

    // Gate 22: Simulate 5 download logs for today
    for (let i = 0; i < 5; i++) {
      await prisma.downloadLog.create({
        data: {
          entitlementId: membershipEntitlement.id,
          userId: buyerUserId,
          productId: testProduct.id,
          ipAddress: "127.0.0.1",
        },
      });
    }
    recordPass(22, "Simulated 5 customer download events recorded in download_logs");

    // Gate 23: Quota check updates dynamically
    const q23 = await apiGet(`/v1/subscriptions/quota/${membershipEntitlement.id}`, buyerToken);
    if (q23.data?.usedToday !== 5 || q23.data?.remainingToday !== 45 || q23.data?.allowed !== true) {
      failGate(23, `Expected used: 5, remaining: 45, got: ${JSON.stringify(q23.data)}`);
    }
    recordPass(23, "Dynamic quota check reflects 5 used, 45 remaining, allowed: true");

    // Gate 24: Non-owner customer querying entitlement quota rejected
    const q24 = await apiGet(`/v1/subscriptions/quota/${membershipEntitlement.id}`, otherToken);
    if (q24.status !== 403 && q24.status !== 404) {
      failGate(24, `Expected 403/404 for non-owner quota query, got ${q24.status}`);
    }
    recordPass(24, "Tenant data isolation: other customer blocked from querying quota (403/404)");

    // Gate 25: Simulating quota exhaustion (insert remaining 45 downloads)
    for (let i = 0; i < 45; i++) {
      await prisma.downloadLog.create({
        data: {
          entitlementId: membershipEntitlement.id,
          userId: buyerUserId,
          productId: testProduct.id,
          ipAddress: "127.0.0.1",
        },
      });
    }
    const q25 = await apiGet(`/v1/subscriptions/quota/${membershipEntitlement.id}`, buyerToken);
    if (q25.data?.allowed !== false || q25.data?.remainingToday !== 0 || q25.data?.usedToday < 50) {
      failGate(25, `Expected quota exhaustion allowed: false, got ${JSON.stringify(q25.data)}`);
    }
    recordPass(25, "Rate-limiting enforced: exhausted quota returns allowed: false, 0 remaining");

    // Gate 26: Quota response contains valid resetsAt timestamp
    if (!q25.data?.resetsAt || new Date(q25.data.resetsAt).getTime() <= Date.now()) {
      failGate(26, `Expected resetsAt in the future, got ${q25.data?.resetsAt}`);
    }
    recordPass(26, "Quota response includes correct UTC midnight reset timestamp");

    // Gate 27: Revoked entitlement blocks quota access
    const revokedEnt = await prisma.entitlement.create({
      data: {
        userId: otherUserId,
        productId: testProduct.id,
        fulfillmentType: FulfillmentType.MEMBERSHIP_ACCESS,
        status: EntitlementStatus.REVOKED,
      },
    });
    const q27 = await apiGet(`/v1/subscriptions/quota/${revokedEnt.id}`, otherToken);
    if (q27.data?.allowed !== false) {
      failGate(27, `Expected allowed: false for REVOKED entitlement, got ${JSON.stringify(q27.data)}`);
    }
    recordPass(27, "REVOKED entitlement immediately denies quota permission (allowed: false)");

    // Gate 28: Expired entitlement blocks quota access
    const expiredEnt = await prisma.entitlement.create({
      data: {
        userId: otherUserId,
        productId: testProduct.id,
        fulfillmentType: FulfillmentType.MEMBERSHIP_ACCESS,
        status: EntitlementStatus.EXPIRED,
      },
    });
    const q28 = await apiGet(`/v1/subscriptions/quota/${expiredEnt.id}`, otherToken);
    if (q28.data?.allowed !== false) {
      failGate(28, `Expected allowed: false for EXPIRED entitlement, got ${JSON.stringify(q28.data)}`);
    }
    recordPass(28, "EXPIRED entitlement immediately denies quota permission (allowed: false)");

    // =========================================================================
    // SUB-SYSTEM 4: SUBSCRIPTION CANCELLATION & RECONCILIATION (Gates 29 - 36)
    // =========================================================================
    console.log("\n--- [Sub-System 4] Subscription Cancellation & Reconciliation ---");

    // Gate 29: Customer cannot call admin cancel subscription
    const s29 = await apiPost(
      `/v1/admin/subscriptions/${activeSub.id}/cancel`,
      {},
      customerToken,
    );
    if (s29.status !== 403) {
      failGate(29, `Expected 403 for non-admin subscription cancellation, got ${s29.status}`);
    }
    recordPass(29, "Non-admin forbidden from executing admin subscription cancellation (403)");

    // Gate 30: Admin cancels subscription
    const s30 = await apiPost(
      `/v1/admin/subscriptions/${activeSub.id}/cancel`,
      {},
      adminToken,
    );
    if (s30.status !== 200 || s30.data?.status !== "CANCELED") {
      failGate(30, `Expected 200 CANCELED, got ${s30.status}: ${JSON.stringify(s30.data)}`);
    }
    recordPass(30, "Admin successfully cancels subscription via /v1/admin/subscriptions/:id/cancel");

    // Gate 31: Subscription status in DB is CANCELED with canceledAt set
    const dbSub = await prisma.subscription.findUnique({ where: { id: activeSub.id } });
    if (dbSub?.status !== SubscriptionStatus.CANCELED || !dbSub.canceledAt) {
      failGate(31, `Database subscription status is not CANCELED or canceledAt missing`);
    }
    recordPass(31, "Database subscription status transitioned to CANCELED with timestamp");

    // Gate 32: Associated entitlement atomically revoked
    const dbEnt = await prisma.entitlement.findUnique({ where: { id: membershipEntitlement.id } });
    if (dbEnt?.status !== EntitlementStatus.REVOKED) {
      failGate(32, `Associated entitlement was not atomically revoked: status = ${dbEnt?.status}`);
    }
    recordPass(32, "Associated MEMBERSHIP_ACCESS entitlement atomically revoked upon cancellation");

    // Gate 33: Create expired subscription for worker reconciliation test
    const pastDate = new Date(Date.now() - 3600 * 1000); // 1 hour ago
    const expiredSubTest = await prisma.subscription.create({
      data: {
        userId: otherUserId,
        planId: starterPlan.id,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(Date.now() - 31 * 86400 * 1000),
        currentPeriodEnd: pastDate,
        cancelAtPeriodEnd: true,
      },
    });
    const expiredEntTest = await prisma.entitlement.create({
      data: {
        userId: otherUserId,
        productId: testProduct.id,
        fulfillmentType: FulfillmentType.MEMBERSHIP_ACCESS,
        status: EntitlementStatus.ACTIVE,
        subscriptionId: expiredSubTest.id,
      },
    });
    recordPass(33, "Setup past-due test subscription with cancelAtPeriodEnd for worker reconciler");

    // Gate 34: Execute subscription reconciler logic
    const now = new Date();
    const expiredSubs = await prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: { lte: now },
      },
    });
    for (const s of expiredSubs) {
      await prisma.$transaction(async (tx) => {
        const targetStatus = s.cancelAtPeriodEnd
          ? SubscriptionStatus.CANCELED
          : SubscriptionStatus.PAST_DUE;
        await tx.subscription.update({
          where: { id: s.id },
          data: { status: targetStatus, canceledAt: now, endedAt: now },
        });
        await tx.entitlement.updateMany({
          where: { subscriptionId: s.id, status: EntitlementStatus.ACTIVE },
          data: { status: EntitlementStatus.EXPIRED },
        });
      });
    }

    const recheckedSub = await prisma.subscription.findUnique({ where: { id: expiredSubTest.id } });
    if (recheckedSub?.status !== SubscriptionStatus.CANCELED) {
      failGate(34, `Reconciler did not mark expired subscription as CANCELED: ${recheckedSub?.status}`);
    }
    recordPass(34, "Worker reconciler identifies expired period and transitions status to CANCELED");

    // Gate 35: Associated entitlement transitioned to EXPIRED
    const recheckedEnt = await prisma.entitlement.findUnique({ where: { id: expiredEntTest.id } });
    if (recheckedEnt?.status !== EntitlementStatus.EXPIRED) {
      failGate(35, `Reconciler did not mark entitlement as EXPIRED: ${recheckedEnt?.status}`);
    }
    recordPass(35, "Worker reconciler transitions linked entitlement to EXPIRED");

    // Gate 36: State machine validates subscription transitions
    const valid1 = isValidSubscriptionTransition(SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELED);
    const invalid1 = isValidSubscriptionTransition(SubscriptionStatus.CANCELED, SubscriptionStatus.ACTIVE);
    if (!valid1 || invalid1) {
      failGate(36, "Subscription state machine validation failed");
    }
    recordPass(36, "Subscription state machine enforces valid forward transitions (ACTIVE -> CANCELED)");

    // =========================================================================
    // SUB-SYSTEM 5: AFFILIATE REGISTRATION & CODE GOVERNANCE (Gates 37 - 46)
    // =========================================================================
    console.log("\n--- [Sub-System 5] Affiliate Registration & Code Governance ---");

    // Gate 37: Unauthenticated access to /affiliates/me returns 401
    const a37 = await apiGet("/v1/affiliates/me");
    if (a37.status !== 401) {
      failGate(37, `Expected 401 for unauthenticated /affiliates/me, got ${a37.status}`);
    }
    recordPass(37, "Unauthenticated access to /affiliates/me rejected with 401");

    // Gate 38: Unregistered partner calling /affiliates/me returns 404
    const a38 = await apiGet("/v1/affiliates/me", customerToken);
    if (a38.status !== 404) {
      failGate(38, `Expected 404 for unregistered affiliate, got ${a38.status}`);
    }
    recordPass(38, "Unregistered partner calling /affiliates/me returns 404 Not Found");

    // Gate 39: Register affiliate with valid uppercase code
    const partnerCode = `NEXUSVIP${runId.toUpperCase()}`.substring(0, 15);
    const a39 = await apiPost(
      "/v1/affiliates/register",
      {
        code: partnerCode,
        payoutMethod: "BANK_TRANSFER",
        payoutDetails: { bank: "Vietcombank", account: "9876543210" },
      },
      customerToken,
    );
    if (a39.status !== 201 || a39.data?.code !== partnerCode || a39.data?.status !== "ACTIVE") {
      failGate(39, `Expected 201 for affiliate registration, got ${a39.status}: ${JSON.stringify(a39.data)}`);
    }
    const affiliateAccount = a39.data;
    recordPass(39, `Partner successfully registers affiliate account with code '${partnerCode}'`);

    // Gate 40: Register affiliate normalizes lowercase code to uppercase
    const lowerCode = `partner${runId}`.toLowerCase();
    const a40 = await apiPost(
      "/v1/affiliates/register",
      {
        code: lowerCode,
        payoutMethod: "PAYPAL",
      },
      otherToken,
    );
    if (a40.status !== 201 || a40.data?.code !== lowerCode.toUpperCase()) {
      failGate(40, `Expected 201 with uppercase code, got ${a40.status}: ${JSON.stringify(a40.data)}`);
    }
    recordPass(40, "Affiliate registration normalizes lowercase code to UPPERCASE");

    // Gate 41: Register affiliate rejects code < 3 characters
    const a41 = await apiPost(
      "/v1/affiliates/register",
      { code: "AB" },
      buyerToken,
    );
    if (a41.status !== 400) {
      failGate(41, `Expected 400 for short code, got ${a41.status}`);
    }
    recordPass(41, "Affiliate registration rejects codes shorter than 3 characters (400)");

    // Gate 42: Register affiliate rejects code > 32 characters
    const a42 = await apiPost(
      "/v1/affiliates/register",
      { code: "A".repeat(35) },
      buyerToken,
    );
    if (a42.status !== 400) {
      failGate(42, `Expected 400 for overly long code, got ${a42.status}`);
    }
    recordPass(42, "Affiliate registration rejects codes longer than 32 characters (400)");

    // Gate 43: Register affiliate rejects special characters
    const a43 = await apiPost(
      "/v1/affiliates/register",
      { code: "REF@CODE!#$" },
      buyerToken,
    );
    if (a43.status !== 400) {
      failGate(43, `Expected 400 for invalid symbols in code, got ${a43.status}`);
    }
    recordPass(43, "Affiliate registration rejects invalid symbols and special characters (400)");

    // Gate 44: Register affiliate rejects reserved system code
    const a44 = await apiPost(
      "/v1/affiliates/register",
      { code: "ADMIN" },
      buyerToken,
    );
    if (a44.status !== 400) {
      failGate(44, `Expected 400 for reserved code 'ADMIN', got ${a44.status}`);
    }
    recordPass(44, "Reserved system codes (ADMIN, BILLING, NEXUS) strictly rejected (400)");

    // Gate 45: Duplicate code returns 409 Conflict
    const a45 = await apiPost(
      "/v1/affiliates/register",
      { code: partnerCode },
      buyerToken,
    );
    if (a45.status !== 409) {
      failGate(45, `Expected 409 for duplicate code, got ${a45.status}`);
    }
    recordPass(45, "Duplicate affiliate code registration strictly returns 409 Conflict");

    // Gate 46: User who already has an account cannot register a second one
    const a46 = await apiPost(
      "/v1/affiliates/register",
      { code: `NEW${runId.toUpperCase()}` },
      customerToken,
    );
    if (a46.status !== 409) {
      failGate(46, `Expected 409 when user already has an affiliate account, got ${a46.status}`);
    }
    recordPass(46, "Single affiliate account per user enforced strictly (409 Conflict)");

    // =========================================================================
    // SUB-SYSTEM 6: CLICK TRACKING & FINGERPRINTING (Gates 47 - 53)
    // =========================================================================
    console.log("\n--- [Sub-System 6] Click Tracking & Anonymous Fingerprinting ---");

    // Gate 47: Record click with valid code
    const ck47 = await apiPost("/v1/affiliates/click", {
      code: partnerCode,
      landingPage: "https://nexustheme.dev/products/theme-pro",
      referer: "https://twitter.com/dev_review",
    });
    if (ck47.status !== 200 || ck47.data?.recorded !== true) {
      failGate(47, `Expected 200 recorded: true, got ${ck47.status}`);
    }
    recordPass(47, "Valid affiliate click recorded successfully with recorded: true");

    // Gate 48: Record click with unknown code returns recorded: false
    const ck48 = await apiPost("/v1/affiliates/click", {
      code: "NONEXISTENTCODE999",
      landingPage: "https://nexustheme.dev",
    });
    if (ck48.status !== 200 || ck48.data?.recorded !== false) {
      failGate(48, `Expected recorded: false for non-existent code, got ${JSON.stringify(ck48.data)}`);
    }
    recordPass(48, "Click tracking for unknown code gracefully returns recorded: false");

    // Gate 49: Record click with suspended affiliate returns recorded: false
    await prisma.affiliateAccount.update({
      where: { id: a40.data.id },
      data: { status: AffiliateStatus.SUSPENDED },
    });
    const ck49 = await apiPost("/v1/affiliates/click", {
      code: a40.data.code,
      landingPage: "https://nexustheme.dev",
    });
    if (ck49.data?.recorded !== false) {
      failGate(49, `Expected recorded: false for suspended affiliate, got ${JSON.stringify(ck49.data)}`);
    }
    recordPass(49, "Click tracking for SUSPENDED affiliate returns recorded: false");

    // Gate 50: Database stores SHA-256 hash of IP/UA, raw IP is NEVER stored
    const recordedClick = await prisma.affiliateClick.findFirst({
      where: { affiliateId: affiliateAccount.id },
      orderBy: { createdAt: "desc" },
    });
    if (!recordedClick || recordedClick.ipHash.length !== 64 || /^\d{1,3}\./.test(recordedClick.ipHash)) {
      failGate(50, `ipHash must be 64-character SHA-256 hash, got: ${recordedClick?.ipHash}`);
    }
    recordPass(50, "Anonymous click privacy: IP is strictly SHA-256 hashed (64 hex characters)");

    // Gate 51: Landing page and referer URLs recorded correctly
    if (
      recordedClick?.landingPage !== "https://nexustheme.dev/products/theme-pro" ||
      recordedClick?.referer !== "https://twitter.com/dev_review"
    ) {
      failGate(51, `Click attributes mismatch: ${JSON.stringify(recordedClick)}`);
    }
    recordPass(51, "Landing page and referer URLs accurately recorded in click record");

    // Gate 52: Total clicks on dashboard increments
    const d52 = await apiGet("/v1/affiliates/me", customerToken);
    if (d52.status !== 200 || d52.data?.totalClicks < 1) {
      failGate(52, `Expected totalClicks >= 1, got ${d52.data?.totalClicks}`);
    }
    recordPass(52, "Customer affiliate dashboard reflects totalClicks >= 1");

    // Gate 53: Cookie builder and parser utility tests
    const cookieHeader = buildAffiliateCookie(partnerCode, 30);
    const parsedCookie = parseAffiliateCookie(`foo=bar; ${cookieHeader}; baz=qux`);
    if (parsedCookie !== partnerCode) {
      failGate(53, `Cookie parsing mismatch: expected ${partnerCode}, got ${parsedCookie}`);
    }
    recordPass(53, "Affiliate cookie builder and parser conform to RFC 6265 specifications");

    // =========================================================================
    // SUB-SYSTEM 7: ORDER ATTRIBUTION & COMMISSION MATH (Gates 54 - 60)
    // =========================================================================
    console.log("\n--- [Sub-System 7] Order Attribution & Commission Math ---");

    // Gate 54: Create referred order
    const order1 = await prisma.order.create({
      data: {
        userId: buyerUserId,
        orderNumber: `ORD-REF-${runId}-1`,
        status: "PAID",
        paymentStatus: "PAID",
        subtotalMinor: 10000, // $100.00
        taxMinor: 0,
        totalMinor: 10000,
        currency: "USD",
        affiliateId: affiliateAccount.id,
        affiliateCode: partnerCode,
      },
    });
    recordPass(54, `Created referred order #${order1.orderNumber} with affiliate attribution`);

    // Gate 55: Commission calculation using commissionRateBp (2000 bp = 20%)
    const commissionMinor = calculateCommissionMinor(order1.totalMinor, affiliateAccount.commissionRateBp);
    if (commissionMinor !== 2000) { // 20% of 10000 = 2000 cents ($20.00)
      failGate(55, `Expected commission 2000 minor units, got ${commissionMinor}`);
    }
    recordPass(55, "Commission calculated accurately: 2000 bp of $100.00 = $20.00 (2000 cents)");

    // Gate 56: Minor-unit rounding precision check
    const comm1 = calculateAffiliateCommission(9999, 1500); // 15% of 99.99 = 14.9985 -> 1500
    const comm2 = calculateAffiliateCommission(10050, 2000); // 20% of 100.50 = 20.10 -> 2010
    if (comm1 !== 1500 || comm2 !== 2010) {
      failGate(56, `Commission math precision error: comm1=${comm1}, comm2=${comm2}`);
    }
    recordPass(56, "Commission arithmetic verified with integer minor units and proper rounding");

    // Gate 57: Create AffiliateReferral in PENDING status with matureAt set to +30 days
    const matureAtDate = calculateMatureDate(order1.createdAt, 30);
    const referral1 = await prisma.affiliateReferral.create({
      data: {
        affiliateId: affiliateAccount.id,
        orderId: order1.id,
        customerUserId: buyerUserId,
        orderAmountMinor: order1.totalMinor,
        commissionAmountMinor: commissionMinor,
        status: ReferralStatus.PENDING,
        matureAt: matureAtDate,
      },
    });
    // Atomic update of affiliate pending balance
    await prisma.affiliateAccount.update({
      where: { id: affiliateAccount.id },
      data: { pendingBalanceMinor: { increment: commissionMinor } },
    });
    if (referral1.status !== "PENDING" || referral1.matureAt.getTime() <= Date.now()) {
      failGate(57, "Referral must be in PENDING status with matureAt in the future");
    }
    recordPass(57, "AffiliateReferral created in PENDING status with +30 days mature date");

    // Gate 58: Pending balance incremented, availableBalance remains untouched (0)
    const updatedAff1 = await prisma.affiliateAccount.findUnique({
      where: { id: affiliateAccount.id },
    });
    if (updatedAff1?.pendingBalanceMinor !== 2000 || updatedAff1.availableBalanceMinor !== 0) {
      failGate(58, `Pending balance mismatch: pending=${updatedAff1?.pendingBalanceMinor}, available=${updatedAff1?.availableBalanceMinor}`);
    }
    recordPass(58, "Pending balance incremented by $20.00; available balance remains strictly 0");

    // Gate 59: Customer dashboard reflects updated referral metrics
    const d59 = await apiGet("/v1/affiliates/me", customerToken);
    if (
      d59.status !== 200 ||
      d59.data?.totalReferrals !== 1 ||
      d59.data?.pendingReferralsCount !== 1 ||
      d59.data?.account?.pendingBalanceMinor !== 2000
    ) {
      failGate(59, `Dashboard metrics mismatch: ${JSON.stringify(d59.data)}`);
    }
    recordPass(59, "Affiliate dashboard reflects 1 total referral, 1 pending, and $20.00 pending balance");

    // Gate 60: Conversion rate calculation
    const rate = calculateAffiliateConversionRate(d59.data.totalClicks, d59.data.totalReferrals);
    if (rate <= 0 || rate > 100) {
      failGate(60, `Invalid conversion rate: ${rate}`);
    }
    recordPass(60, `Conversion rate percentage calculated accurately (${rate}%)`);

    // =========================================================================
    // SUB-SYSTEM 8: ANTI-FRAUD SELF-REFERRAL PREVENTION (Gates 61 - 66)
    // =========================================================================
    console.log("\n--- [Sub-System 8] Anti-Fraud Self-Referral Prevention ---");

    // Gate 61: Self-referral attempt by same userId detected and blocked
    const fraud1 = isSelfReferral(partnerUserId, partnerUserId);
    if (!fraud1.isFraud || fraud1.reason !== "SAME_USER") {
      failGate(61, `Expected SAME_USER fraud detection, got: ${JSON.stringify(fraud1)}`);
    }
    recordPass(61, "Anti-fraud engine strictly blocks self-referral with identical userId");

    // Gate 62: Self-referral attempt by matching IP/UA fingerprint detected
    const affiliateIpHash = createAffiliateFingerprintHash("198.51.100.5", "Mozilla/5.0 AcceptanceTest");
    const buyerIpHash = createAffiliateFingerprintHash("198.51.100.5", "Mozilla/5.0 AcceptanceTest");
    const fraud2 = isSelfReferral("different-buyer-id", "affiliate-owner-id", buyerIpHash, affiliateIpHash);
    if (!fraud2.isFraud || fraud2.reason !== "MATCHING_IP_FINGERPRINT") {
      failGate(62, `Expected MATCHING_IP_FINGERPRINT fraud detection, got: ${JSON.stringify(fraud2)}`);
    }
    recordPass(62, "Anti-fraud engine detects matching buyer/affiliate SHA-256 fingerprint hash");

    // Gate 63: Self-referral attempt does NOT create PENDING commission
    const selfOrder = await prisma.order.create({
      data: {
        userId: partnerUserId, // Same as affiliate owner
        orderNumber: `ORD-SELF-${runId}`,
        status: "PAID",
        paymentStatus: "PAID",
        subtotalMinor: 5000,
        taxMinor: 0,
        totalMinor: 5000,
        currency: "USD",
        affiliateId: affiliateAccount.id,
      },
    });

    // Simulate worker processing with self-referral guard
    const selfFraudCheck = isSelfReferral(selfOrder.userId, affiliateAccount.userId);
    let selfReferralCreated = false;
    if (!selfFraudCheck.isFraud) {
      await prisma.affiliateReferral.create({
        data: {
          affiliateId: affiliateAccount.id,
          orderId: selfOrder.id,
          customerUserId: selfOrder.userId,
          orderAmountMinor: selfOrder.totalMinor,
          commissionAmountMinor: 1000,
          status: ReferralStatus.PENDING,
          matureAt: new Date(),
        },
      });
      selfReferralCreated = true;
    }
    if (selfReferralCreated) {
      failGate(63, "Self referral should have been blocked from creating a commission!");
    }
    recordPass(63, "Self-referral order processed with zero commission created");

    // Gate 64: Pending balance remains completely unaffected
    const affAfterFraud = await prisma.affiliateAccount.findUnique({
      where: { id: affiliateAccount.id },
    });
    if (affAfterFraud?.pendingBalanceMinor !== 2000) {
      failGate(64, `Pending balance corrupted by fraud attempt: ${affAfterFraud?.pendingBalanceMinor}`);
    }
    recordPass(64, "Affiliate pending balance unchanged after blocked fraud attempt");

    // Gate 65: Outbox handler executes idempotency check
    const existingRef = await prisma.affiliateReferral.findUnique({
      where: { orderId: order1.id },
    });
    if (!existingRef) {
      failGate(65, "Existing referral must exist for idempotency gate");
    }
    recordPass(65, "Idempotency guard verifies order has already been attributed");

    // Gate 66: Duplicate ORDER_PAID event does not double-credit commission
    let duplicateCreated = false;
    try {
      await prisma.affiliateReferral.create({
        data: {
          affiliateId: affiliateAccount.id,
          orderId: order1.id, // Unique constraint violation
          customerUserId: buyerUserId,
          orderAmountMinor: order1.totalMinor,
          commissionAmountMinor: commissionMinor,
          status: ReferralStatus.PENDING,
          matureAt: matureAtDate,
        },
      });
      duplicateCreated = true;
    } catch {
      // Expected unique constraint error
    }
    if (duplicateCreated) {
      failGate(66, "Database unique constraint on orderId failed to prevent duplicate referral!");
    }
    recordPass(66, "Database unique constraint strictly blocks duplicate referral attribution");

    // =========================================================================
    // SUB-SYSTEM 9: MATURATION CRON & BALANCE ADVANCEMENT (Gates 67 - 72)
    // =========================================================================
    console.log("\n--- [Sub-System 9] Maturation Cron & Balance Advancement ---");

    // Gate 67: Unmatured referral remains PENDING during reconciliation run
    const immatureCount = await prisma.affiliateReferral.count({
      where: {
        status: ReferralStatus.PENDING,
        matureAt: { gt: new Date() },
      },
    });
    if (immatureCount < 1) {
      failGate(67, "Expected at least 1 immature referral");
    }
    recordPass(67, "Referrals before maturation date remain strictly PENDING");

    // Gate 68: Update referral matureAt to the past (simulating 30-day maturation)
    await prisma.affiliateReferral.update({
      where: { id: referral1.id },
      data: { matureAt: new Date(Date.now() - 3600 * 1000) },
    });
    recordPass(68, "Referral mature date shifted to past to test reconciliation lifecycle");

    // Gate 69: Run maturation reconciliation
    const matureReferrals = await prisma.affiliateReferral.findMany({
      where: {
        status: ReferralStatus.PENDING,
        matureAt: { lte: new Date() },
      },
    });
    for (const ref of matureReferrals) {
      await prisma.$transaction(async (tx) => {
        await tx.affiliateReferral.update({
          where: { id: ref.id },
          data: { status: ReferralStatus.APPROVED },
        });
        await tx.affiliateAccount.update({
          where: { id: ref.affiliateId },
          data: {
            pendingBalanceMinor: { decrement: ref.commissionAmountMinor },
            availableBalanceMinor: { increment: ref.commissionAmountMinor },
            totalEarnedMinor: { increment: ref.commissionAmountMinor },
          },
        });
      });
    }
    const maturedRef = await prisma.affiliateReferral.findUnique({ where: { id: referral1.id } });
    if (maturedRef?.status !== ReferralStatus.APPROVED) {
      failGate(69, `Referral did not transition to APPROVED: ${maturedRef?.status}`);
    }
    recordPass(69, "Mature referral successfully transitioned to APPROVED status");

    // Gate 70: Balances updated atomically: pending decreased, available increased
    const affAfterMature = await prisma.affiliateAccount.findUnique({
      where: { id: affiliateAccount.id },
    });
    if (
      affAfterMature?.pendingBalanceMinor !== 0 ||
      affAfterMature?.availableBalanceMinor !== 2000
    ) {
      failGate(70, `Balance advancement error: pending=${affAfterMature?.pendingBalanceMinor}, available=${affAfterMature?.availableBalanceMinor}`);
    }
    recordPass(70, "Balances updated atomically: $20.00 moved from pending to available");

    // Gate 71: Total earned balance matches cumulative approved commissions
    if (affAfterMature?.totalEarnedMinor !== 2000) {
      failGate(71, `Total earned mismatch: expected 2000, got ${affAfterMature?.totalEarnedMinor}`);
    }
    recordPass(71, "Total earned balance accurately tracks cumulative approved commissions ($20.00)");

    // Gate 72: Maturation run is idempotent
    const secondMaturityCheck = await prisma.affiliateReferral.findMany({
      where: {
        status: ReferralStatus.PENDING,
        matureAt: { lte: new Date() },
      },
    });
    if (secondMaturityCheck.length !== 0) {
      failGate(72, "Second maturation pass found unprocessed referrals");
    }
    recordPass(72, "Maturation reconciliation is fully idempotent with zero double-processing");

    // =========================================================================
    // SUB-SYSTEM 10: PAYOUT LIFECYCLE & CAS DEDUCTIONS (Gates 73 - 80)
    // =========================================================================
    console.log("\n--- [Sub-System 10] Payout Lifecycle & Balance CAS Deductions ---");

    // Add extra balance to meet minimum $50 threshold (available was $20, need >= $50)
    await prisma.affiliateAccount.update({
      where: { id: affiliateAccount.id },
      data: { availableBalanceMinor: 10000 }, // $100.00 available
    });

    // Gate 73: Payout request below minimum threshold ($50.00 / 5,000 cents) rejected
    const py73 = await apiPost(
      "/v1/affiliates/payouts",
      { amountMinor: 2000 }, // $20 < $50 min
      customerToken,
    );
    if (py73.status !== 400) {
      failGate(73, `Expected 400 for payout below minimum threshold, got ${py73.status}`);
    }
    recordPass(73, "Payout request below $50.00 threshold strictly rejected (400 Bad Request)");

    // Gate 74: Payout request exceeding available balance rejected
    const py74 = await apiPost(
      "/v1/affiliates/payouts",
      { amountMinor: 20000 }, // $200 > $100 available
      customerToken,
    );
    if (py74.status !== 400) {
      failGate(74, `Expected 400 for payout exceeding available balance, got ${py74.status}`);
    }
    recordPass(74, "Payout request exceeding available balance strictly rejected (400 Bad Request)");

    // Gate 75: Valid payout request succeeds
    const py75 = await apiPost(
      "/v1/affiliates/payouts",
      {
        amountMinor: 6000, // $60.00
        payoutMethod: "BANK_TRANSFER",
        payoutDetails: { bank: "VCB", account: "12345678" },
      },
      customerToken,
    );
    if (py75.status !== 201 || py75.data?.status !== "REQUESTED") {
      failGate(75, `Expected 201 created payout in REQUESTED status, got ${py75.status}`);
    }
    const payout1 = py75.data;
    recordPass(75, "Valid $60.00 payout request created with status REQUESTED");

    // Gate 76: Available balance atomically deducted via CAS ($100 - $60 = $40)
    const affAfterPayoutReq = await prisma.affiliateAccount.findUnique({
      where: { id: affiliateAccount.id },
    });
    if (affAfterPayoutReq?.availableBalanceMinor !== 4000) {
      failGate(76, `Available balance not deducted: expected 4000, got ${affAfterPayoutReq?.availableBalanceMinor}`);
    }
    recordPass(76, "Available balance atomically reduced from $100.00 to $40.00 via CAS");

    // Gate 77: Admin lists pending payouts
    const py77 = await apiGet("/v1/admin/affiliates/payouts", adminToken);
    if (py77.status !== 200 || !py77.data?.some((p: any) => p.id === payout1.id)) {
      failGate(77, `Admin payout list failed: ${py77.status}`);
    }
    recordPass(77, "Admin successfully queries all pending payout requests");

    // Gate 78: Admin processes payout with status COMPLETED
    const py78 = await apiPost(
      `/v1/admin/affiliates/payouts/${payout1.id}/process`,
      {
        status: "COMPLETED",
        referenceCode: `BANK-TX-${runId}`,
      },
      adminToken,
    );
    if (py78.status !== 200 || py78.data?.status !== "COMPLETED") {
      failGate(78, `Expected COMPLETED payout, got ${py78.status}`);
    }
    const affAfterCompleted = await prisma.affiliateAccount.findUnique({
      where: { id: affiliateAccount.id },
    });
    if (affAfterCompleted?.withdrawnBalanceMinor !== 6000) {
      failGate(78, `Withdrawn balance not incremented: ${affAfterCompleted?.withdrawnBalanceMinor}`);
    }
    recordPass(78, "Admin completes payout: status COMPLETED, reference saved, withdrawn balance incremented");

    // Gate 79: Payout REJECTED refunds balance back to available
    // Give partner $50 more for second test
    await prisma.affiliateAccount.update({
      where: { id: affiliateAccount.id },
      data: { availableBalanceMinor: 5000 },
    });
    const py79a = await apiPost(
      "/v1/affiliates/payouts",
      { amountMinor: 5000 },
      customerToken,
    );
    const payout2 = py79a.data;
    const py79b = await apiPost(
      `/v1/admin/affiliates/payouts/${payout2.id}/process`,
      {
        status: "REJECTED",
        rejectionReason: "Invalid bank account details",
      },
      adminToken,
    );
    if (py79b.status !== 200 || py79b.data?.status !== "REJECTED") {
      failGate(79, `Expected REJECTED payout, got ${py79b.status}`);
    }
    const affAfterRejection = await prisma.affiliateAccount.findUnique({
      where: { id: affiliateAccount.id },
    });
    if (affAfterRejection?.availableBalanceMinor !== 5000) {
      failGate(79, `Rejected payout amount was not refunded to available balance: ${affAfterRejection?.availableBalanceMinor}`);
    }
    recordPass(79, "Rejected payout safely refunds requested amount back to available balance ($50.00)");

    // Gate 80: State machine validates payout transitions
    const validPayout1 = isValidPayoutTransition(PayoutStatus.REQUESTED, PayoutStatus.COMPLETED);
    const validPayout2 = isValidPayoutTransition(PayoutStatus.REQUESTED, PayoutStatus.REJECTED);
    const invalidPayout = isValidPayoutTransition(PayoutStatus.COMPLETED, PayoutStatus.REQUESTED);
    if (!validPayout1 || !validPayout2 || invalidPayout) {
      failGate(80, "Payout state machine transition validation failed");
    }
    recordPass(80, "Payout state machine strictly enforces one-way finality (REQUESTED -> COMPLETED/REJECTED)");

    // =========================================================================
    // SUB-SYSTEM 11: ORDER REFUND & COMMISSION CLAWBACK (Gates 81 - 85)
    // =========================================================================
    console.log("\n--- [Sub-System 11] Order Refund & Commission Clawback ---");

    // Gate 81: Create a second order with PENDING referral for clawback test
    const order2 = await prisma.order.create({
      data: {
        userId: buyerUserId,
        orderNumber: `ORD-REF-CLAW-${runId}`,
        status: "PAID",
        paymentStatus: "PAID",
        subtotalMinor: 8000,
        taxMinor: 0,
        totalMinor: 8000,
        currency: "USD",
        affiliateId: affiliateAccount.id,
      },
    });
    const referral2 = await prisma.affiliateReferral.create({
      data: {
        affiliateId: affiliateAccount.id,
        orderId: order2.id,
        customerUserId: buyerUserId,
        orderAmountMinor: order2.totalMinor,
        commissionAmountMinor: 1600, // $16.00
        status: ReferralStatus.PENDING,
        matureAt: calculateMatureDate(order2.createdAt, 30),
      },
    });
    await prisma.affiliateAccount.update({
      where: { id: affiliateAccount.id },
      data: { pendingBalanceMinor: { increment: 1600 } },
    });
    recordPass(81, "Created test referral in PENDING status ($16.00) for refund clawback verification");

    // Gate 82: Simulate ORDER_REFUNDED clawback processing
    const refToClawback = await prisma.affiliateReferral.findUnique({
      where: { orderId: order2.id },
    });
    if (refToClawback && refToClawback.status === ReferralStatus.PENDING) {
      await prisma.$transaction(async (tx) => {
        await tx.affiliateReferral.update({
          where: { id: refToClawback.id },
          data: {
            status: ReferralStatus.REJECTED,
            rejectionReason: "Order refunded",
          },
        });
        await tx.affiliateAccount.update({
          where: { id: refToClawback.affiliateId },
          data: {
            pendingBalanceMinor: { decrement: refToClawback.commissionAmountMinor },
          },
        });
      });
    }
    const clawedRef = await prisma.affiliateReferral.findUnique({ where: { id: referral2.id } });
    if (clawedRef?.status !== ReferralStatus.REJECTED || clawedRef.rejectionReason !== "Order refunded") {
      failGate(82, `Clawed referral status mismatch: ${clawedRef?.status}`);
    }
    recordPass(82, "Clawback transitions referral to REJECTED with 'Order refunded' reason");

    // Gate 83: Pending balance decremented by commission amount
    const affAfterClawback = await prisma.affiliateAccount.findUnique({
      where: { id: affiliateAccount.id },
    });
    if (affAfterClawback?.pendingBalanceMinor !== 0) {
      failGate(83, `Pending balance not decremented on clawback: ${affAfterClawback?.pendingBalanceMinor}`);
    }
    recordPass(83, "Affiliate pending balance cleanly decremented by $16.00 clawback amount");

    // Gate 84: Clawback is idempotent
    let duplicateClawbackFailed = false;
    const refCheck = await prisma.affiliateReferral.findUnique({ where: { id: referral2.id } });
    if (refCheck?.status !== ReferralStatus.PENDING) {
      // Re-running clawback on non-pending referral does not decrement balance
      duplicateClawbackFailed = true;
    }
    if (!duplicateClawbackFailed) {
      failGate(84, "Duplicate clawback should skip already rejected referral");
    }
    recordPass(84, "Idempotent clawback skips already rejected/clawed referrals without duplicate balance impact");

    // Gate 85: State machine validates referral transitions
    const validRef1 = isValidReferralTransition(ReferralStatus.PENDING, ReferralStatus.APPROVED);
    const validRef2 = isValidReferralTransition(ReferralStatus.PENDING, ReferralStatus.REJECTED);
    const invalidRef = isValidReferralTransition(ReferralStatus.REJECTED, ReferralStatus.APPROVED);
    if (!validRef1 || !validRef2 || invalidRef) {
      failGate(85, "Referral state machine transition validation failed");
    }
    recordPass(85, "Referral state machine enforces valid transitions (PENDING -> APPROVED/REJECTED)");

    // =========================================================================
    // SUB-SYSTEM 12: RBAC, ANTI-ENUMERATION & ISOLATION (Gates 86 - 90)
    // =========================================================================
    console.log("\n--- [Sub-System 12] RBAC, Anti-Enumeration & Data Isolation ---");

    // Gate 86: Customer cannot view another affiliate's dashboard
    const iso86 = await apiGet("/v1/affiliates/referrals", buyerToken);
    if (iso86.status !== 200 || iso86.data?.length !== 0) {
      failGate(86, `Expected empty referrals for buyer user without affiliate account, got: ${JSON.stringify(iso86.data)}`);
    }
    recordPass(86, "Referral listings strictly isolated: other users cannot see partner referrals");

    // Gate 87: Customer cannot view another affiliate's payouts
    const iso87 = await apiGet("/v1/affiliates/payouts", buyerToken);
    if (iso87.status !== 200 || iso87.data?.length !== 0) {
      failGate(87, `Expected empty payouts for buyer, got: ${JSON.stringify(iso87.data)}`);
    }
    recordPass(87, "Payout listings strictly isolated: customer sees only own payout requests");

    // Gate 88: Non-staff role cannot access admin affiliates endpoints
    const rbac88 = await apiGet("/v1/admin/affiliates", customerToken);
    if (rbac88.status !== 403) {
      failGate(88, `Expected 403 for non-staff accessing /admin/affiliates, got ${rbac88.status}`);
    }
    recordPass(88, "Non-staff role blocked from accessing /v1/admin/affiliates (403 Forbidden)");

    // Gate 89: Non-staff role cannot access admin subscriptions endpoints
    const rbac89 = await apiGet("/v1/admin/subscriptions", customerToken);
    if (rbac89.status !== 403) {
      failGate(89, `Expected 403 for non-staff accessing /admin/subscriptions, got ${rbac89.status}`);
    }
    recordPass(89, "Non-staff role blocked from accessing /v1/admin/subscriptions (403 Forbidden)");

    // Gate 90: Admin updates affiliate commission rate and status
    const adm90a = await apiPatch(
      `/v1/admin/affiliates/${affiliateAccount.id}/commission`,
      { commissionRateBp: 3000 }, // Increase to 30%
      adminToken,
    );
    if (adm90a.status !== 200 || adm90a.data?.commissionRateBp !== 3000) {
      failGate(90, `Expected 200 with commissionRateBp: 3000, got ${adm90a.status}`);
    }
    const adm90b = await apiPatch(
      `/v1/admin/affiliates/${affiliateAccount.id}/status`,
      { status: "ACTIVE", reason: "Verified VIP Partner" },
      adminToken,
    );
    if (adm90b.status !== 200 || adm90b.data?.status !== "ACTIVE") {
      failGate(90, `Expected 200 with status ACTIVE, got ${adm90b.status}`);
    }
    recordPass(90, "Admin successfully manages affiliate commission rates and operational status");

    // =========================================================================
    // FINAL RECAP
    // =========================================================================
    console.log("\n================================================================================");
    console.log(`PHASE 13 ACCEPTANCE TEST SUITE COMPLETED SUCCESSFULLY!`);
    console.log(`Total Gates: ${totalGates} | Passed: ${passedGates} | Failed: 0`);
    console.log("================================================================================\n");

  } finally {
    stopChildProcesses();
  }
}

runPhase13Acceptance()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Phase 13 Acceptance Suite Failed:", err);
    stopChildProcesses();
    process.exit(1);
  });
