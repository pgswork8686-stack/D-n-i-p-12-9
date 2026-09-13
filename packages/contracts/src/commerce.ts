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
