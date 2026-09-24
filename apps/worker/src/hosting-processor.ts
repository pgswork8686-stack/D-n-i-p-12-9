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
} from "@nexus/utils";
import * as crypto from "crypto";

export interface HostingWorkerOptions {
  batchSize?: number;
  workerId?: string;
}

function getEncryptionKey(): string {
  const raw =
    process.env.HOSTING_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    "nexus_phase14_hosting_infrastructure_secret_encryption_key_2026";
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

    // Find active hosting server
    let server = await prisma.hostingServer.findFirst({
      where: {
        isActive: true,
        activeAccounts: { lt: prisma.hostingServer.fields.maxAccounts },
      },
      orderBy: { activeAccounts: "asc" },
    });

    if (!server) {
      server = await prisma.hostingServer.findFirst({
        where: { isActive: true },
        orderBy: { activeAccounts: "asc" },
      });
    }

    if (!server) {
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

      // Execute provisioning
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
    // In background sync, simulate or update metrics
    const simulatedDisk = Math.min(account.diskLimitMb, account.diskUsageMb + 10);
    const simulatedBandwidth = Math.min(account.bandwidthLimitMb, account.bandwidthUsageMb + 50);

    await prisma.hostingAccount.update({
      where: { id: account.id },
      data: {
        diskUsageMb: simulatedDisk,
        bandwidthUsageMb: simulatedBandwidth,
      },
    });

    if (isApproachingQuota(simulatedDisk, account.diskLimitMb, 90)) {
      console.warn(
        JSON.stringify({
          level: "warn",
          service: "worker",
          event: "hosting_account_quota_alert",
          workerId,
          accountId: account.id,
          domain: account.domain,
          diskUsageMb: simulatedDisk,
          diskLimitMb: account.diskLimitMb,
          timestamp: new Date().toISOString(),
        }),
      );
    }

    reconciledCount++;
  }

  return { reconciledCount };
}
