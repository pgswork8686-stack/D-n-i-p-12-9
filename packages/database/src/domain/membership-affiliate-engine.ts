import {
  SubscriptionStatus,
  ReferralStatus,
  PayoutStatus,
  BillingInterval,
  SubscriptionTier,
} from "@prisma/client";

export const DEFAULT_REFERRAL_HOLD_DAYS = 30;
export const MIN_PAYOUT_AMOUNT_MINOR_VND = 500000;
export const MIN_PAYOUT_AMOUNT_MINOR_USD = 5000; // $50.00 USD

/**
 * Valid state transitions for Subscriptions
 */
export function isValidSubscriptionTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): boolean {
  if (from === to) return false;

  switch (from) {
    case "INCOMPLETE":
      return to === "ACTIVE" || to === "CANCELED";
    case "TRIALING":
      return to === "ACTIVE" || to === "PAST_DUE" || to === "CANCELED";
    case "ACTIVE":
      return to === "PAST_DUE" || to === "CANCELED";
    case "PAST_DUE":
      return to === "ACTIVE" || to === "UNPAID" || to === "CANCELED";
    case "UNPAID":
      return to === "ACTIVE" || to === "CANCELED";
    case "CANCELED":
      return false; // Terminal state
    default:
      return false;
  }
}

/**
 * Valid state transitions for Affiliate Referrals
 */
export function isValidReferralTransition(
  from: ReferralStatus,
  to: ReferralStatus,
): boolean {
  if (from === to) return false;

  switch (from) {
    case "PENDING":
      return to === "APPROVED" || to === "REJECTED";
    case "APPROVED":
      return to === "PAID" || to === "REJECTED";
    case "REJECTED":
      return false; // Terminal state
    case "PAID":
      return false; // Terminal state
    default:
      return false;
  }
}

/**
 * Valid state transitions for Affiliate Payouts
 */
export function isValidPayoutTransition(
  from: PayoutStatus,
  to: PayoutStatus,
): boolean {
  if (from === to) return false;

  switch (from) {
    case "REQUESTED":
      return to === "PROCESSING" || to === "REJECTED" || to === "COMPLETED";
    case "PROCESSING":
      return to === "COMPLETED" || to === "REJECTED";
    case "COMPLETED":
      return false; // Terminal state
    case "REJECTED":
      return false; // Terminal state
    default:
      return false;
  }
}

/**
 * Anti-fraud check: Prevents an affiliate from referring themselves
 */
export function isSelfReferral(
  customerUserId: string,
  affiliateUserId: string,
  clickIpHash?: string | null,
  customerIpHash?: string | null,
): { isFraud: boolean; reason?: string } {
  if (customerUserId && affiliateUserId && customerUserId === affiliateUserId) {
    return {
      isFraud: true,
      reason: "SELF_REFERRAL_SAME_USER",
    };
  }

  if (
    clickIpHash &&
    customerIpHash &&
    clickIpHash !== "unknown-ip" &&
    clickIpHash === customerIpHash
  ) {
    return {
      isFraud: true,
      reason: "SELF_REFERRAL_SAME_IP",
    };
  }

  return { isFraud: false };
}

/**
 * Calculates commission in minor currency units from order amount and basis points
 */
export function calculateCommissionMinor(
  orderAmountMinor: number,
  commissionRateBp: number,
): number {
  if (orderAmountMinor <= 0 || commissionRateBp <= 0) {
    return 0;
  }
  const rawCommission = Math.floor((orderAmountMinor * commissionRateBp) / 10000);
  return Math.min(orderAmountMinor, Math.max(0, rawCommission));
}

/**
 * Calculates mature date for holding period (default 30 days)
 */
export function calculateMatureDate(
  orderPaidAt: Date = new Date(),
  holdDays: number = DEFAULT_REFERRAL_HOLD_DAYS,
): Date {
  const d = new Date(orderPaidAt.getTime());
  d.setUTCDate(d.getUTCDate() + Math.max(0, holdDays));
  return d;
}

/**
 * Calculates the next period end date based on billing interval
 */
export function calculateNextPeriodEnd(
  from: Date,
  interval: BillingInterval,
): Date {
  const next = new Date(from.getTime());
  switch (interval) {
    case "WEEKLY":
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case "MONTHLY":
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    case "QUARTERLY":
      next.setUTCMonth(next.getUTCMonth() + 3);
      break;
    case "YEARLY":
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
    case "LIFETIME":
      next.setUTCFullYear(next.getUTCFullYear() + 100);
      break;
    default:
      next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next;
}
