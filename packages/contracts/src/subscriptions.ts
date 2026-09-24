import type { BillingInterval } from "./catalog";

export type SubscriptionTier = "STARTER" | "PRO" | "AGENCY" | "ALL_ACCESS";
export type SubscriptionStatus =
  | "INCOMPLETE"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED"
  | "UNPAID"
  | "TRIALING";

export interface SubscriptionPlanDto {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  tier: SubscriptionTier;
  interval: BillingInterval;
  priceMinor: number;
  currency: string;
  dailyDownloadQuota: number;
  maxActivationsPerProduct: number;
  features?: string[] | null;
  isActive: boolean;
  stripePriceId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionDto {
  id: string;
  userId: string;
  planId: string;
  status: SubscriptionStatus;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  canceledAt?: string | null;
  trialEndsAt?: string | null;
  endedAt?: string | null;
  dailyDownloadQuota: number;
  downloadsUsedToday: number;
  quotaRemainingToday: number;
  plan: SubscriptionPlanDto;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSubscriptionSessionRequest {
  planId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CreatePortalSessionRequest {
  returnUrl: string;
}

export interface SessionResponseDto {
  sessionUrl: string;
  sessionId?: string;
}

export interface CheckMembershipQuotaResponse {
  allowed: boolean;
  dailyLimit: number;
  usedToday: number;
  remainingToday: number;
  resetsAt: string;
}

export interface AdminCreatePlanRequest {
  name: string;
  slug: string;
  description?: string;
  tier: SubscriptionTier;
  interval: BillingInterval;
  priceMinor: number;
  currency: string;
  dailyDownloadQuota: number;
  maxActivationsPerProduct?: number;
  features?: string[];
  isActive?: boolean;
  stripePriceId?: string;
}

export interface AdminUpdatePlanRequest {
  name?: string;
  description?: string;
  dailyDownloadQuota?: number;
  maxActivationsPerProduct?: number;
  features?: string[];
  isActive?: boolean;
  stripePriceId?: string;
}
