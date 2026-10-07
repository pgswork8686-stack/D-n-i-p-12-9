import {
  prisma,
  FulfillmentType,
  HostingAccountStatus,
  HostingProvider,
  DnsRecordType,
  DnsRecordStatus,
  isApproachingQuota,
} from "@nexus/database";
import {
  generateHostingUsername,
  encryptHostingCredential,
  decryptHostingCredential,
  resolveHostingEncryptionSecret,
} from "@nexus/utils";
import * as crypto from "crypto";

export interface HostingWorkerOptions {
  batchSize?: number;
  workerId?: string;
}

function getEncryptionKey(): string {
  const raw = resolveHostingEncryptionSecret();
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function decryptToken(authEncryptedToken: string): string {
  try {
    const parsed = JSON.parse(authEncryptedToken);
    const key = getEncryptionKey();
    return decryptHostingCredential(parsed.encrypted, parsed.iv, parsed.tag, key);
  } catch {
    return "";
  }
}

/**
 * Authoritatively provisions hosting accounts for orders containing HOSTING_PROVISIONING entitlements.
 * Strictly idempotent: skips entitlements that already have an associated HostingAccount.
 */
export async function processHostingProvisioningForOrder(
  orderId: string,
  workerId = "worker-default",
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: true,
      entitlements: {
        where: {
          fulfillmentType: FulfillmentType.HOSTING_PROVISIONING,
        },
      },
    },
  });

  if (!order || !order.entitlements || order.entitlements.length === 0) {
    return { provisionedCount: 0 };
  }

  let provisionedCount = 0;

  for (const ent of order.entitlements) {
    // Idempotency check: see if hosting account already exists for this entitlement
    const existing = await prisma.hostingAccount.findUnique({
      where: { entitlementId: ent.id },
    });

    if (existing) {
      continue;
    }

    // Determine domain from metadata or fall back to default formatted domain
    const meta = (ent.metadata as Record<string, any>) || {};
    const domain =
      meta.domain ||
      `site-${order.orderNumber.toLowerCase()}-${ent.id.slice(0, 6)}.nexustheme.dev`;
    const cleanDomain = domain.trim().toLowerCase();

    const isProduction = process.env.NODE_ENV === "production";

    // Find an active hosting server with spare capacity. Never overfill a
    // server, and never fall back to the simulated MOCK provider in production.
    let server = await prisma.hostingServer.findFirst({
      where: {
        isActive: true,
        activeAccounts: { lt: prisma.hostingServer.fields.maxAccounts },
        ...(isProduction ? { provider: { not: HostingProvider.MOCK } } : {}),
      },
      orderBy: { activeAccounts: "asc" },
    });

    if (!server && isProduction) {
      console.error(
        JSON.stringify({
          level: "error",
          service: "worker",
          event: "hosting_no_capacity",
          workerId,
          orderId,
          entitlementId: ent.id,
          message:
            "No active hosting server with capacity; provisioning requires operator action",
          timestamp: new Date().toISOString(),
        }),
      );
      continue;
    }

    if (!server) {
      // Local/test only: seed a simulated server so the flow can be exercised.
      const key = getEncryptionKey();
      const enc = encryptHostingCredential("mock-default-worker-token", key);
      server = await prisma.hostingServer.create({
        data: {
          name: "Default Nexus Cloud Node 1",
          hostname: "cloud1.nexusnode.net",
          provider: HostingProvider.MOCK,
          endpointUrl: "https://cloud1.nexusnode.net:2083",
          ipAddress: "192.0.2.10",
          maxAccounts: 500,
          activeAccounts: 0,
          authEncryptedToken: JSON.stringify(enc),
          isActive: true,
        },
      });
    }

    const username = generateHostingUsername(cleanDomain);

    try {
      // Create initial PROVISIONING account
      const account = await prisma.hostingAccount.create({
        data: {
          userId: order.userId,
          serverId: server.id,
          entitlementId: ent.id,
          orderId: order.id,
          domain: cleanDomain,
          username,
          packagePlan: meta.packagePlan || "standard",
          status: HostingAccountStatus.PROVISIONING,
          diskLimitMb: 5120,
          bandwidthLimitMb: 51200,
        },
      });

      if (server.provider !== HostingProvider.MOCK) {
        // Real control panels (cPanel/DirectAdmin) are provisioned by the API
        // (HostingService.provisionAccountInternal via admin retry), which owns
        // the panel adapters. Never mark ACTIVE without a real panel account.
        console.log(
          JSON.stringify({
            level: "info",
            service: "worker",
            event: "hosting_account_awaiting_provisioning",
            workerId,
            orderId,
            entitlementId: ent.id,
            accountId: account.id,
            timestamp: new Date().toISOString(),
          }),
        );
        continue;
      }

      // Simulated provisioning (MOCK provider, non-production only)
      await prisma.$transaction(async (tx) => {
        await tx.hostingAccount.update({
          where: { id: account.id },
          data: {
            status: HostingAccountStatus.ACTIVE,
          },
        });

        await tx.hostingServer.update({
          where: { id: server!.id },
          data: {
            activeAccounts: { increment: 1 },
          },
        });

        await tx.hostingDnsRecord.createMany({
          data: [
            {
              hostingAccountId: account.id,
              type: DnsRecordType.A,
              name: "@",
              content: server!.ipAddress,
              ttl: 3600,
              proxied: true,
              status: DnsRecordStatus.ACTIVE,
            },
            {
              hostingAccountId: account.id,
              type: DnsRecordType.CNAME,
              name: "www",
              content: cleanDomain,
              ttl: 3600,
              proxied: true,
              status: DnsRecordStatus.ACTIVE,
            },
          ],
          skipDuplicates: true,
        });

        await tx.outboxEvent.create({
          data: {
            eventType: "HOSTING_ACCOUNT_PROVISIONED",
            aggregateType: "HostingAccount",
            aggregateId: account.id,
            payload: {
              accountId: account.id,
              domain: account.domain,
              username: account.username,
              userId: account.userId,
              serverId: server!.id,
              entitlementId: ent.id,
              orderId: order.id,
            },
            status: "PENDING",
          },
        });
      });

      provisionedCount++;

      console.log(
        JSON.stringify({
          level: "info",
          service: "worker",
          event: "hosting_account_provisioned",
          workerId,
          orderId,
          entitlementId: ent.id,
          domain: cleanDomain,
          username,
          timestamp: new Date().toISOString(),
        }),
      );
    } catch (err: any) {
      console.error(
        JSON.stringify({
          level: "error",
          service: "worker",
          event: "hosting_account_provisioning_error",
          workerId,
          orderId,
          entitlementId: ent.id,
          error: err?.message || String(err),
          timestamp: new Date().toISOString(),
        }),
      );
    }
  }

  return { provisionedCount };
}

/**
 * Suspends all active hosting accounts associated with an order (e.g. on refund or chargeback).
 */
export async function suspendHostingAccountsForOrder(
  orderId: string,
  reason = "Order refunded",
  workerId = "worker-default",
) {
  const accounts = await prisma.hostingAccount.findMany({
    where: {
      orderId,
      status: HostingAccountStatus.ACTIVE,
    },
  });

  if (!accounts || accounts.length === 0) {
    return { suspendedCount: 0 };
  }

  let suspendedCount = 0;

  for (const account of accounts) {
    await prisma.$transaction(async (tx) => {
      await tx.hostingAccount.update({
        where: { id: account.id },
        data: {
          status: HostingAccountStatus.SUSPENDED,
          suspendedAt: new Date(),
          suspensionReason: reason,
        },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: "HOSTING_ACCOUNT_SUSPENDED",
          aggregateType: "HostingAccount",
          aggregateId: account.id,
          payload: {
            accountId: account.id,
            domain: account.domain,
            orderId,
            reason,
          },
          status: "PENDING",
        },
      });
    });

    suspendedCount++;

    console.log(
      JSON.stringify({
        level: "info",
        service: "worker",
        event: "hosting_account_suspended",
        workerId,
        accountId: account.id,
        domain: account.domain,
        reason,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  return { suspendedCount };
}

/**
 * Suspends hosting account when parent entitlement is revoked or expired.
 */
export async function suspendHostingForRevokedEntitlement(
  entitlementId: string,
  reason = "Entitlement revoked or expired",
  workerId = "worker-default",
) {
  const account = await prisma.hostingAccount.findFirst({
    where: {
      entitlementId,
      status: HostingAccountStatus.ACTIVE,
    },
  });

  if (!account) {
    return false;
  }

  await prisma.$transaction(async (tx) => {
    await tx.hostingAccount.update({
      where: { id: account.id },
      data: {
        status: HostingAccountStatus.SUSPENDED,
        suspendedAt: new Date(),
        suspensionReason: reason,
      },
    });

    await tx.outboxEvent.create({
      data: {
        eventType: "HOSTING_ACCOUNT_SUSPENDED",
        aggregateType: "HostingAccount",
        aggregateId: account.id,
        payload: {
          accountId: account.id,
          domain: account.domain,
          entitlementId,
          reason,
        },
        status: "PENDING",
      },
    });
  });

  console.log(
    JSON.stringify({
      level: "info",
      service: "worker",
      event: "hosting_account_suspended_for_revocation",
      workerId,
      accountId: account.id,
      entitlementId,
      reason,
      timestamp: new Date().toISOString(),
    }),
  );

  return true;
}

/**
 * Periodic background task: synchronizes disk and bandwidth metrics for active accounts.
 */
export async function reconcileHostingUsage(options?: HostingWorkerOptions) {
  const workerId = options?.workerId || "worker-default";
  const batchSize = options?.batchSize || 50;

  const accounts = await prisma.hostingAccount.findMany({
    where: { status: HostingAccountStatus.ACTIVE },
    take: batchSize,
  });

  let reconciledCount = 0;

  for (const account of accounts) {
    // Usage figures are written only by HostingService.syncAccountUsage, which
    // reads them from the real control panel. The worker never fabricates
    // metrics; it only evaluates quota alerts on the last synced values.
    if (isApproachingQuota(account.diskUsageMb, account.diskLimitMb, 90)) {
      console.warn(
        JSON.stringify({
          level: "warn",
          service: "worker",
          event: "hosting_account_quota_alert",
          workerId,
          accountId: account.id,
          domain: account.domain,
          diskUsageMb: account.diskUsageMb,
          diskLimitMb: account.diskLimitMb,
          timestamp: new Date().toISOString(),
        }),
      );
    }

    reconciledCount++;
  }

  return { reconciledCount };
}
