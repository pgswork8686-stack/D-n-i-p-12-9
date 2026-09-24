import {
  prisma,
  AffiliateStatus,
  ReferralStatus,
  isSelfReferral,
  calculateCommissionMinor,
  calculateMatureDate,
  isValidReferralTransition,
} from "@nexus/database";

export async function processAffiliateReferralForOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) return null;

  let affiliateId = order.affiliateId;

  // If order has code but no id, resolve account
  if (!affiliateId && order.affiliateCode) {
    const account = await prisma.affiliateAccount.findUnique({
      where: { code: order.affiliateCode },
    });
    if (account) {
      affiliateId = account.id;
    }
  }

  if (!affiliateId) {
    return null;
  }

  const affiliate = await prisma.affiliateAccount.findUnique({
    where: { id: affiliateId },
  });

  if (!affiliate || affiliate.status !== AffiliateStatus.ACTIVE) {
    return null;
  }

  // Anti-fraud self-referral check
  const fraudCheck = isSelfReferral(order.userId, affiliate.userId);
  if (fraudCheck.isFraud) {
    console.log(
      JSON.stringify({
        level: "warn",
        service: "worker",
        event: "self_referral_blocked",
        orderId,
        affiliateId: affiliate.id,
        reason: fraudCheck.reason,
        timestamp: new Date().toISOString(),
      }),
    );
    return null;
  }

  // Idempotency: Check if already created
  const existing = await prisma.affiliateReferral.findUnique({
    where: { orderId },
  });
  if (existing) {
    return existing;
  }

  const commission = calculateCommissionMinor(
    order.totalAmount,
    affiliate.commissionRateBp,
  );
  const matureAt = calculateMatureDate(new Date(), 30);

  return prisma.$transaction(async (tx) => {
    const ref = await tx.affiliateReferral.create({
      data: {
        affiliateId: affiliate.id,
        orderId,
        customerUserId: order.userId,
        orderAmountMinor: order.totalAmount,
        commissionAmountMinor: commission,
        status: ReferralStatus.PENDING,
        matureAt,
      },
    });

    await tx.affiliateAccount.update({
      where: { id: affiliate.id },
      data: {
        pendingBalanceMinor: { increment: BigInt(commission) },
        totalEarnedMinor: { increment: BigInt(commission) },
      },
    });

    return ref;
  });
}

export async function clawbackAffiliateReferralForOrder(
  orderId: string,
  reason = "ORDER_REFUNDED",
) {
  const referral = await prisma.affiliateReferral.findUnique({
    where: { orderId },
  });
  if (!referral) return false;

  if (!isValidReferralTransition(referral.status, ReferralStatus.REJECTED)) {
    return false;
  }

  return prisma.$transaction(async (tx) => {
    await tx.affiliateReferral.update({
      where: { id: referral.id },
      data: {
        status: ReferralStatus.REJECTED,
        rejectedAt: new Date(),
        rejectionReason: reason,
      },
    });

    if (referral.status === ReferralStatus.PENDING) {
      await tx.affiliateAccount.update({
        where: { id: referral.affiliateId },
        data: {
          pendingBalanceMinor: { decrement: BigInt(referral.commissionAmountMinor) },
          totalEarnedMinor: { decrement: BigInt(referral.commissionAmountMinor) },
        },
      });
    } else if (referral.status === ReferralStatus.APPROVED) {
      await tx.affiliateAccount.update({
        where: { id: referral.affiliateId },
        data: {
          availableBalanceMinor: { decrement: BigInt(referral.commissionAmountMinor) },
          totalEarnedMinor: { decrement: BigInt(referral.commissionAmountMinor) },
        },
      });
    }

    return true;
  });
}

/**
 * Reconciles mature referrals: Transitions PENDING -> APPROVED after hold window expires.
 */
export async function reconcileMatureAffiliateReferrals(batchSize = 100) {
  const matureReferrals = await prisma.affiliateReferral.findMany({
    where: {
      status: ReferralStatus.PENDING,
      matureAt: { lte: new Date() },
    },
    take: batchSize,
    orderBy: { matureAt: "asc" },
  });

  let approvedCount = 0;

  for (const ref of matureReferrals) {
    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.affiliateReferral.updateMany({
          where: {
            id: ref.id,
            status: ReferralStatus.PENDING,
          },
          data: {
            status: ReferralStatus.APPROVED,
            approvedAt: new Date(),
          },
        });

        if (updated.count > 0) {
          await tx.affiliateAccount.update({
            where: { id: ref.affiliateId },
            data: {
              pendingBalanceMinor: { decrement: BigInt(ref.commissionAmountMinor) },
              availableBalanceMinor: { increment: BigInt(ref.commissionAmountMinor) },
            },
          });
          approvedCount++;
        }
      });
    } catch (err: any) {
      console.error(`Failed to reconcile referral ${ref.id}:`, err?.message || err);
    }
  }

  return { approvedCount };
}
