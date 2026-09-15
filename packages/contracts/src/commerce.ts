import { Currency, FulfillmentType, ProductType } from "./catalog";

export type CartStatus = "ACTIVE" | "CONVERTED" | "ABANDONED";
export type OrderStatus = "PENDING_PAYMENT" | "PAID" | "CANCELLED";
export type PaymentStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export type OutboxEventStatus =
  "PENDING" | "PROCESSING" | "PROCESSED" | "FAILED";

export interface CartItemDto {
  id: string;
  cartId: string;
  variantId: string;
  priceId?: string | null;
  productId: string;
  productName: string;
  variantName: string;
  sku: string;
  productType: ProductType;
  fulfillmentType: FulfillmentType;
  quantity: number;
  unitAmount: number;
  lineTotalAmount: number;
  currency: Currency;
  isAvailable: boolean;
  unavailableReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CartDto {
  id: string;
  userId: string;
  status: CartStatus;
  currency: Currency;
  subtotalAmount: number;
  totalAmount: number;
  itemCount: number;
  items: CartItemDto[];
  createdAt: string;
  updatedAt: string;
}

export interface AddToCartRequest {
  cartId?: string;
  variantId: string;
  quantity: number;
  priceId?: string;
  currency?: Currency;
}

export interface UpdateCartItemRequest {
  quantity: number;
}

export interface OrderItemDto {
  id: string;
  orderId: string;
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  productType: ProductType;
  fulfillmentType: FulfillmentType;
  unitAmount: number;
  quantity: number;
  lineTotalAmount: number;
  currency: Currency;
  licensePlanIdAtPurchase?: string | null;
  isLifetime?: boolean;
  durationDays?: number | null;
  durationMonths?: number | null;
  maxActivations?: number | null;
  updatesDays?: number | null;
  supportDays?: number | null;
  snapshotVersion?: number | null;
  metadata?: Record<string, any> | null;
  createdAt: string;
}

export interface PaymentDto {
  id: string;
  orderId: string;
  provider: string;
  providerReference?: string | null;
  status: PaymentStatus;
  amount: number;
  currency: Currency;
  metadata?: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderDto {
  id: string;
  orderNumber: string;
  userId: string;
  status: OrderStatus;
  currency: Currency;
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  cartId?: string | null;
  metadata?: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItemDto[];
  payments?: PaymentDto[];
}

export interface CheckoutRequest {
  currency: Currency;
  idempotencyKey?: string;
}

export interface CheckoutResponse {
  order: OrderDto;
  payment: PaymentDto;
  testPaymentAction?: {
    paymentId: string;
    callbackUrl: string;
    availableActions: ("succeeded" | "failed" | "cancelled")[];
  };
}

export interface TestPaymentCallbackRequest {
  paymentId: string;
  externalEventId: string;
  eventType: "payment.succeeded" | "payment.failed" | "payment.cancelled";
  metadata?: Record<string, any>;
}

export interface TestPaymentCallbackResponse {
  success: boolean;
  duplicate: boolean;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  message: string;
}

export interface OrderFilterQuery {
  page?: number;
  limit?: number;
  status?: OrderStatus;
  userId?: string;
}

export interface CreatePaymentSessionRequest {
  provider?: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface PaymentSessionResponse {
  sessionId: string;
  sessionUrl: string;
  provider: string;
  providerReference: string;
  paymentId: string;
  orderId: string;
  amount: number;
  currency: Currency;
}

export interface PaymentWebhookResponse {
  success: boolean;
  duplicate: boolean;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  message: string;
}

export interface ReconcilePaymentResponse {
  success: boolean;
  transitioned: boolean;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  message: string;
}

export const DEFAULT_STRIPE_WEBHOOK_TOLERANCE = 300;
export const MAX_STRIPE_WEBHOOK_TOLERANCE = 900;

export function resolveStripeWebhookTolerance(
  val?: string | number | null,
): number {
  if (val === undefined || val === null || val === "") {
    return DEFAULT_STRIPE_WEBHOOK_TOLERANCE;
  }
  const num = typeof val === "number" ? val : Number(val);
  if (
    !Number.isFinite(num) ||
    !Number.isInteger(num) ||
    num <= 0 ||
    num > MAX_STRIPE_WEBHOOK_TOLERANCE
  ) {
    throw new Error(
      `Invalid STRIPE_WEBHOOK_TOLERANCE_SECONDS '${val}': must be a positive integer between 1 and ${MAX_STRIPE_WEBHOOK_TOLERANCE} seconds`,
    );
  }
  return num;
}

export enum PaymentReconcileReason {
  SCHEDULED_SWEEP = "scheduled_sweep",
  OPS_MANUAL = "ops_manual",
  ABANDONED_CHECK = "abandoned_check",
  AUTHORITATIVE_QUERY = "authoritative_query",
}

export interface ReconcilePaymentRequest {
  reason?: PaymentReconcileReason;
}

