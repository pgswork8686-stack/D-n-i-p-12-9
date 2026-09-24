export type AffiliateStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED";
export type ReferralStatus = "PENDING" | "APPROVED" | "REJECTED" | "PAID";
export type PayoutStatus = "REQUESTED" | "PROCESSING" | "COMPLETED" | "REJECTED";
export type PayoutMethod = "BANK_TRANSFER" | "PAYPAL" | "CRYPTO";

export interface AffiliateAccountDto {
  id: string;
  userId: string;
  code: string;
  status: AffiliateStatus;
  commissionRateBp: number;
  payoutMethod: PayoutMethod;
  payoutDetails?: Record<string, unknown> | null;
  totalEarnedMinor: number;
  pendingBalanceMinor: number;
  availableBalanceMinor: number;
  withdrawnBalanceMinor: number;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterAffiliateRequest {
  code: string;
  payoutMethod?: PayoutMethod;
  payoutDetails?: Record<string, unknown>;
}

export interface AffiliateClickRequest {
  code: string;
  landingPage: string;
  referer?: string;
  utmSource?: string;
  utmCampaign?: string;
}

export interface AffiliateClickResponse {
  recorded: boolean;
  code: string;
  affiliateId?: string;
}

export interface AffiliateReferralDto {
  id: string;
  affiliateId: string;
  orderId: string;
  customerUserId: string;
  orderAmountMinor: number;
  commissionAmountMinor: number;
  status: ReferralStatus;
  matureAt: string;
  rejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestPayoutRequest {
  amountMinor: number;
  payoutMethod?: PayoutMethod;
  payoutDetails?: Record<string, unknown>;
}

export interface AffiliatePayoutDto {
  id: string;
  affiliateId: string;
  amountMinor: number;
  currency: string;
  status: PayoutStatus;
  payoutMethod: PayoutMethod;
  referenceCode?: string | null;
  rejectionReason?: string | null;
  requestedAt: string;
  processedAt?: string | null;
  processedBy?: string | null;
}

export interface AffiliateDashboardStatsDto {
  account: AffiliateAccountDto;
  totalClicks: number;
  totalReferrals: number;
  pendingReferralsCount: number;
  conversionRatePercent: number;
  recentReferrals: AffiliateReferralDto[];
}

export interface AdminUpdateAffiliateStatusRequest {
  status: AffiliateStatus;
  reason?: string;
}

export interface AdminUpdateCommissionRequest {
  commissionRateBp: number;
}

export interface AdminProcessPayoutRequest {
  status: "COMPLETED" | "REJECTED";
  referenceCode?: string;
  rejectionReason?: string;
}
