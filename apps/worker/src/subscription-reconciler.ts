import {
  prisma,
  SubscriptionStatus,
  EntitlementStatus,
} from "@nexus/database";

export async function reconcileExpiredSubscriptions(batchSize = 100) {
  const now = new Date();

  // Find active subscriptions whose period has passed
  const expiredSubs = await prisma.subscription.findMany({
    where: {
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: { lte: now },
    },
    take: batchSize,
    orderBy: { currentPeriodEnd: "asc" },
  });

  let transitionedCount = 0;

  for (const sub of expiredSubs) {
    try {
      await prisma.$transaction(async (tx) => {
        const targetStatus = sub.cancelAtPeriodEnd
          ? SubscriptionStatus.CANCELED
          : SubscriptionStatus.PAST_DUE;

        const updated = await tx.subscription.updateMany({
          where: {
            id: sub.id,
            status: SubscriptionStatus.ACTIVE,
          },
          data: {
            status: targetStatus,
            canceledAt: targetStatus === SubscriptionStatus.CANCELED ? now : undefined,
            endedAt: targetStatus === SubscriptionStatus.CANCELED ? now : undefined,
          },
        });

        if (updated.count > 0) {
          // If canceled, revoke linked entitlements
          if (targetStatus === SubscriptionStatus.CANCELED) {
            await tx.entitlement.updateMany({
              where: {
                subscriptionId: sub.id,
                status: EntitlementStatus.ACTIVE,
              },
              data: {
                status: EntitlementStatus.REVOKED,
                revokedAt: now,
              },
            });
          }
          transitionedCount++;
        }
      });
    } catch (err: any) {
      console.error(`Failed to reconcile subscription ${sub.id}:`, err?.message || err);
    }
  }

  return { transitionedCount };
}
