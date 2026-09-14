export type LicenseFulfillmentMode = "MANUAL_EXTERNAL";
export type ProviderStatus = "ACTIVE" | "INACTIVE";
export type ProviderAccountStatus = "ACTIVE" | "EXHAUSTED" | "SUSPENDED";
export type AllocationStatus =
  | "PENDING"
  | "ACTIVE"
  | "DEACTIVATION_PENDING"
  | "DEACTIVATED"
  | "REJECTED";

export interface LicenseAllocationDto {
  id: string;
  entitlementId: string;
  providerId: string;
  providerAccountId?: string | null;
  userId: string;
  domain: string;
  normalizedDomain: string;
  status: AllocationStatus;
  requestedAt: string;
  activatedAt?: string | null;
  deactivatedAt?: string | null;
  metadata?: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerAllocationDto {
  id: string;
  entitlementId: string;
  providerCode: string;
  domain: string;
  normalizedDomain: string;
  status: AllocationStatus;
  fulfillmentMode: LicenseFulfillmentMode;
  requestedAt: string;
  activatedAt?: string | null;
  deactivatedAt?: string | null;
  createdAt: string;
}

export interface LicenseProviderDto {
  id: string;
  code: string;
  name: string;
  status: ProviderStatus;
  fulfillmentMode: LicenseFulfillmentMode;
  metadata?: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

export const PROVIDER_CAPACITY_CONSUMING_STATUSES = [
  "ACTIVE",
  "DEACTIVATION_PENDING",
] as const;

export interface ProviderAccountDto {
  id: string;
  providerId: string;
  name: string;
  externalReference?: string | null;
  totalCapacity: number;
  activeAllocationsCount?: number;
  consumedAllocationsCount?: number;
  availableCapacity?: number;
  status: ProviderAccountStatus;
  metadata?: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestAllocationRequest {
  domain: string;
}

export interface AdminActivateAllocationRequest {
  providerAccountId: string;
  notes?: string;
}

export interface AdminRejectAllocationRequest {
  reason: string;
}

export interface RequestDeactivationRequest {
  reason?: string;
}

export interface AdminConfirmDeactivatedRequest {
  notes?: string;
}

export interface CreateProviderAccountRequest {
  providerId: string;
  name: string;
  totalCapacity: number;
  externalReference?: string;
  status?: ProviderAccountStatus;
  metadata?: Record<string, any>;
}

export interface UpdateProviderAccountRequest {
  name?: string;
  totalCapacity?: number;
  externalReference?: string | null;
  status?: ProviderAccountStatus;
  metadata?: Record<string, any>;
}

export interface AdminAllocationFilterQuery {
  status?: AllocationStatus;
  providerId?: string;
  providerAccountId?: string;
  entitlementId?: string;
  userId?: string;
  domain?: string;
  page?: number;
  limit?: number;
}
