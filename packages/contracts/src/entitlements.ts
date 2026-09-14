export type EntitlementStatus = "ACTIVE" | "REVOKED" | "EXPIRED";

export interface EntitlementDto {
  id: string;
  userId: string;
  orderId: string;
  orderItemId: string;
  productId: string;
  variantId: string;
  productType: string;
  fulfillmentType: string;
  status: EntitlementStatus;
  quantity: number;
  activatedAt: string;
  expiresAt?: string | null;
  revokedAt?: string | null;
  maxActivations?: number | null;
  updatesUntil?: string | null;
  supportUntil?: string | null;
  metadata?: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

export interface EntitlementFilterQuery {
  status?: EntitlementStatus;
  productId?: string;
  fulfillmentType?: string;
  page?: number;
  limit?: number;
}

export interface AdminEntitlementFilterQuery extends EntitlementFilterQuery {
  userId?: string;
  orderId?: string;
}

export interface RevokeEntitlementRequest {
  reason?: string;
}
