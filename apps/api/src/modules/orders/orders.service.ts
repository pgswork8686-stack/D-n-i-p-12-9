import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from "@nestjs/common";
import * as crypto from "crypto";
import {
  prisma,
  Order,
  OrderItem,
  Payment,
  OrderStatus,
  ProductStatus,
  VariantStatus,
  IdempotencyKeyStatus,
} from "@nexus/database";
import {
  OrderDto,
  OrderItemDto,
  PaymentDto,
  CheckoutResponse,
  PaginatedResponse,
} from "@nexus/contracts";
import { AuditService } from "../audit/audit.service";
import { CheckoutDto, OrderFilterDto } from "./dto/orders.dto";
import { lockActiveCartByUser } from "../cart/cart-lock.helper";

const MAX_SAFE_AMOUNT = 2147483647; // PostgreSQL Int32 limit

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(private readonly auditService: AuditService) {}

  /**
   * Generates a unique, human-readable order number.
   * Format: ORD-YYYYMMDD-XXXXX
   */
  private generateOrderNumber(): string {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randPart = Math.random().toString(36).substring(2, 7).toUpperCase();
    return `ORD-${datePart}-${randPart}`;
  }

  /**
   * Converts Order + OrderItem + Payment DB records to OrderDto.
   */
  private mapOrderToDto(
    order: Order & {
      items?: OrderItem[];
      payments?: Payment[];
    },
  ): OrderDto {
    const itemsDto: OrderItemDto[] = (order.items || []).map((item) => ({
      id: item.id,
      orderId: item.orderId,
      productId: item.productId,
      variantId: item.variantId,
      productName: item.productName,
      variantName: item.variantName,
      sku: item.sku,
      productType: item.productType,
      fulfillmentType: item.fulfillmentType,
      unitAmount: item.unitAmount,
      quantity: item.quantity,
      lineTotalAmount: item.lineTotalAmount,
      currency: item.currency,
      metadata: item.metadata as Record<string, any> | null,
      createdAt: item.createdAt.toISOString(),
    }));

    const paymentsDto: PaymentDto[] = (order.payments || []).map((pay) => ({
      id: pay.id,
      orderId: pay.orderId,
      provider: pay.provider,
      providerReference: pay.providerReference,
      status: pay.status,
      amount: pay.amount,
      currency: pay.currency,
      metadata: pay.metadata as Record<string, any> | null,
      createdAt: pay.createdAt.toISOString(),
      updatedAt: pay.updatedAt.toISOString(),
    }));

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      status: order.status,
      currency: order.currency,
      subtotalAmount: order.subtotalAmount,
      discountAmount: order.discountAmount,
      totalAmount: order.totalAmount,
      cartId: order.cartId,
      metadata: order.metadata as Record<string, any> | null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      items: itemsDto,
      payments: paymentsDto,
    };
  }

  /**
   * Bounded polling helper for same-key concurrent checkouts.
   * Polls until the leader commits the transaction and populates the response.
   */
  private async pollIdempotencyResponse(
    userId: string,
    key: string,
    requestFingerprint: string,
    maxWaitMs: number = 4000,
    intervalMs: number = 25,
  ): Promise<CheckoutResponse> {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      const record = await prisma.idempotencyKey.findUnique({
        where: {
          scope_userId_key: {
            scope: "checkout",
            userId,
            key,
          },
        },
      });

      if (!record) {
        throw new ConflictException(
          "Concurrent checkout failed or was cancelled. Please retry.",
        );
      }

      if (record.requestFingerprint !== requestFingerprint) {
        throw new ConflictException(
          "Idempotency key reused with different request payload",
        );
      }

      if (
        record.response &&
        record.status === IdempotencyKeyStatus.COMMITTED
      ) {
        return record.response as unknown as CheckoutResponse;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new ConflictException(
      "Checkout is in progress, please try again shortly",
    );
  }

  /**
   * Authoritative checkout:
   * 1. Scoped idempotency reservation (status: IN_PROGRESS) to serialize concurrent requests.
   * 2. Atomic transaction:
   *    - Acquires row lock (SELECT FOR UPDATE) on active Cart row.
   *    - Enforces single currency invariant against Cart.currency.
   *    - Claims cart via CAS (status: ACTIVE -> CONVERTED, affected rows == 1).
   *    - Validates live item snapshots and strict price constraints (ZERO fallback!).
   *    - Computes totals in integer minor units with bounds.
   *    - Creates Order (PENDING_PAYMENT, cartId unique).
   *    - Creates immutable OrderItem snapshots.
   *    - Creates Payment (PENDING).
   *    - Updates idempotency record (COMMITTED + response).
   *    - Writes transactional audit log.
   */
  async checkout(userId: string, dto: CheckoutDto): Promise<CheckoutResponse> {
    const requestFingerprint = crypto
      .createHash("sha256")
      .update(JSON.stringify({ userId, currency: dto.currency }))
      .digest("hex");

    const STALE_IN_PROGRESS_MS = 10_000; // 10s crash lease timeout

    if (dto.idempotencyKey) {
      const existingKey = await prisma.idempotencyKey.findUnique({
        where: {
          scope_userId_key: {
            scope: "checkout",
            userId,
            key: dto.idempotencyKey,
          },
        },
      });

      if (existingKey) {
        if (existingKey.expiresAt < new Date()) {
          throw new ConflictException("Idempotency key has expired");
        }

        if (existingKey.requestFingerprint !== requestFingerprint) {
          throw new ConflictException(
            "Idempotency key reused with different request payload",
          );
        }

        if (
          existingKey.response &&
          existingKey.status === IdempotencyKeyStatus.COMMITTED
        ) {
          this.logger.log(
            `Idempotent checkout hit for key '${dto.idempotencyKey}'`,
          );
          return existingKey.response as unknown as CheckoutResponse;
        }

        if (existingKey.status === IdempotencyKeyStatus.IN_PROGRESS) {
          const isStale =
            Date.now() - new Date(existingKey.startedAt).getTime() >
            STALE_IN_PROGRESS_MS;

          if (isStale) {
            // CAS reclaim of stale lease
            const staleThreshold = new Date(Date.now() - STALE_IN_PROGRESS_MS);
            const reclaim = await prisma.idempotencyKey.updateMany({
              where: {
                scope: "checkout",
                userId,
                key: dto.idempotencyKey,
                status: IdempotencyKeyStatus.IN_PROGRESS,
                startedAt: { lte: staleThreshold },
              },
              data: {
                startedAt: new Date(),
              },
            });

            if (reclaim.count > 0) {
              this.logger.warn(
                `Reclaimed stale idempotency lease for key '${dto.idempotencyKey}'`,
              );
              // Leader role claimed, proceed to execute checkout transaction below
            } else {
              // Lost reclaim race to another concurrent request -> poll
              return this.pollIdempotencyResponse(
                userId,
                dto.idempotencyKey,
                requestFingerprint,
              );
            }
          } else {
            // Still actively processing within lease window -> poll
            return this.pollIdempotencyResponse(
              userId,
              dto.idempotencyKey,
              requestFingerprint,
            );
          }
        }
      } else {
        // Key does not exist yet -> reserve IN_PROGRESS
        try {
          await prisma.idempotencyKey.create({
            data: {
              key: dto.idempotencyKey,
              scope: "checkout",
              userId,
              requestFingerprint,
              status: IdempotencyKeyStatus.IN_PROGRESS,
              startedAt: new Date(),
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          });
        } catch (err: any) {
          if (
            err?.code === "P2002" ||
            err?.message?.includes("idempotency_keys")
          ) {
            // Another concurrent request beat us to create the key -> poll
            return this.pollIdempotencyResponse(
              userId,
              dto.idempotencyKey,
              requestFingerprint,
            );
          }
          throw err;
        }
      }
    }

    try {
      const orderNumber = this.generateOrderNumber();

      const result = await prisma.$transaction(async (tx) => {
        // 1. Lock active cart row FOR UPDATE FIRST! (fail closed)
        const lockedCartRow = await lockActiveCartByUser(tx, userId);

        if (!lockedCartRow) {
          const convertedCart = await tx.cart.findFirst({
            where: { userId, status: "CONVERTED" },
            orderBy: { updatedAt: "desc" },
          });
          if (convertedCart) {
            throw new ConflictException(
              "Cart has already been checked out or is no longer active",
            );
          }
          throw new BadRequestException("Cannot checkout: Cart is empty");
        }

        // 2. Strict single-currency invariant: cart currency must match dto.currency
        if (lockedCartRow.currency !== dto.currency) {
          throw new BadRequestException(
            `Cannot checkout: Cart currency '${lockedCartRow.currency}' does not match requested currency '${dto.currency}'`,
          );
        }

        // 3. Load items under the locked cart
        const cart = await tx.cart.findUnique({
          where: { id: lockedCartRow.id },
          include: {
            items: {
              include: {
                price: true,
                variant: {
                  include: {
                    product: true,
                    prices: {
                      where: {
                        isActive: true,
                      },
                    },
                  },
                },
              },
              orderBy: { createdAt: "asc" },
            },
          },
        });

        if (!cart || cart.items.length === 0) {
          throw new BadRequestException("Cannot checkout: Cart is empty");
        }

        // 4. CAS claim cart
        const claimResult = await tx.cart.updateMany({
          where: {
            id: cart.id,
            userId,
            status: "ACTIVE",
          },
          data: {
            status: "CONVERTED",
          },
        });

        if (claimResult.count === 0) {
          throw new ConflictException(
            "Cart has already been checked out or is no longer active",
          );
        }

        // 5. Strict item and price validation inside transaction snapshot (ZERO fallback!)
        let subtotalAmount = 0;
        const itemsSnapshotData = cart.items.map((item) => {
          const variant = item.variant;
          if (!variant || variant.status !== VariantStatus.ACTIVE) {
            throw new BadRequestException(
              `Cannot checkout: Variant '${variant?.sku || item.variantId}' is not active`,
            );
          }
          if (
            !variant.product ||
            variant.product.status !== ProductStatus.ACTIVE
          ) {
            throw new BadRequestException(
              `Cannot checkout: Product '${variant.product?.slug || variant.productId}' is not active`,
            );
          }

          // Authoritative price resolution: item.price relation takes precedence, NO fallback
          let price = item.price;
          if (!price && item.priceId && variant.prices) {
            price = variant.prices.find((p) => p.id === item.priceId) as any;
          }
          if (!price && !item.priceId && variant.prices) {
            const matches = variant.prices.filter(
              (p) => p.currency === dto.currency && p.isActive,
            );
            if (matches.length === 1) {
              price = matches[0] as any;
            }
          }

          if (!price) {
            throw new BadRequestException(
              `Cannot checkout: Price for variant '${variant.sku}' was not found`,
            );
          }

          if (!price.isActive) {
            throw new BadRequestException(
              `Cannot checkout: Price '${price.id}' for variant '${variant.sku}' is no longer active`,
            );
          }

          if (price.currency !== dto.currency) {
            throw new BadRequestException(
              `Cannot checkout: Price currency '${price.currency}' does not match requested currency '${dto.currency}'`,
            );
          }

          if (price.variantId && price.variantId !== variant.id) {
            throw new BadRequestException(
              `Cannot checkout: Price '${price.id}' does not belong to variant '${variant.sku}'`,
            );
          }

          const unitAmount = price.amount;
          if (
            unitAmount < 0 ||
            !Number.isSafeInteger(unitAmount) ||
            unitAmount > MAX_SAFE_AMOUNT
          ) {
            throw new BadRequestException(
              "Unit price exceeds allowable bounds",
            );
          }

          if (
            !Number.isInteger(item.quantity) ||
            item.quantity < 1 ||
            item.quantity > 999
          ) {
            throw new BadRequestException(
              "Quantity must be an integer between 1 and 999",
            );
          }

          const lineTotalAmount = unitAmount * item.quantity;
          if (
            !Number.isSafeInteger(lineTotalAmount) ||
            lineTotalAmount > MAX_SAFE_AMOUNT
          ) {
            throw new BadRequestException(
              "Line total amount exceeds allowable bounds",
            );
          }

          subtotalAmount += lineTotalAmount;
          if (
            !Number.isSafeInteger(subtotalAmount) ||
            subtotalAmount > MAX_SAFE_AMOUNT
          ) {
            throw new BadRequestException(
              "Order subtotal exceeds allowable bounds",
            );
          }

          return {
            productId: variant.product.id,
            variantId: variant.id,
            productName: variant.product.name,
            variantName: variant.name,
            sku: variant.sku,
            productType: variant.product.productType,
            fulfillmentType: variant.product.fulfillmentType,
            unitAmount,
            quantity: item.quantity,
            lineTotalAmount,
            currency: dto.currency,
          };
        });

        const discountAmount = 0;
        const totalAmount = subtotalAmount - discountAmount;

        // Create Order (Order.cartId is unique in DB)
        const order = await tx.order.create({
          data: {
            orderNumber,
            userId,
            status: OrderStatus.PENDING_PAYMENT,
            currency: dto.currency,
            subtotalAmount,
            discountAmount,
            totalAmount,
            cartId: cart.id,
          },
        });

        // Create immutable OrderItem snapshots
        const orderItems = await Promise.all(
          itemsSnapshotData.map((snapshot) =>
            tx.orderItem.create({
              data: {
                orderId: order.id,
                ...snapshot,
              },
            }),
          ),
        );

        // Create initial Payment
        const payment = await tx.payment.create({
          data: {
            orderId: order.id,
            provider: "TEST",
            status: "PENDING",
            amount: totalAmount,
            currency: dto.currency,
          },
        });

        const orderDto = this.mapOrderToDto({
          ...order,
          items: orderItems,
          payments: [payment],
        });

        const paymentDto: PaymentDto = {
          id: payment.id,
          orderId: payment.orderId,
          provider: payment.provider,
          providerReference: payment.providerReference,
          status: payment.status,
          amount: payment.amount,
          currency: payment.currency,
          metadata: payment.metadata as Record<string, any> | null,
          createdAt: payment.createdAt.toISOString(),
          updatedAt: payment.updatedAt.toISOString(),
        };

        const response: CheckoutResponse = {
          order: orderDto,
          payment: paymentDto,
          testPaymentAction: {
            paymentId: payment.id,
            callbackUrl: "/payments/test-callback",
            availableActions: ["succeeded", "failed", "cancelled"],
          },
        };

        if (dto.idempotencyKey) {
          await tx.idempotencyKey.update({
            where: {
              scope_userId_key: {
                scope: "checkout",
                userId,
                key: dto.idempotencyKey,
              },
            },
            data: {
              status: IdempotencyKeyStatus.COMMITTED,
              response: response as any,
            },
          });
        }

        // Transactional financial audit log
        await this.auditService.logActionWithClient(tx, {
          action: "ORDER_CREATED",
          entity: "Order",
          entityId: order.id,
          actorId: userId,
          details: {
            orderNumber: order.orderNumber,
            totalAmount: order.totalAmount,
            currency: order.currency,
            itemCount: orderItems.length,
          },
        });

        return response;
      });

      this.logger.log(
        `Order ${result.order.orderNumber} created for user ${userId}, total: ${result.order.totalAmount} ${result.order.currency}`,
      );

      return result;
    } catch (err: any) {
      if (dto.idempotencyKey) {
        try {
          await prisma.idempotencyKey.deleteMany({
            where: {
              scope: "checkout",
              userId,
              key: dto.idempotencyKey,
              status: IdempotencyKeyStatus.IN_PROGRESS,
            },
          });
        } catch (cleanupErr) {
          this.logger.error(
            "Failed to clean up in-progress idempotency reservation",
            cleanupErr,
          );
        }
      }

      if (
        err?.code === "P2002" &&
        err?.message?.includes("orders_cart_id_key")
      ) {
        throw new ConflictException(
          "Cart has already been converted to an order",
        );
      }
      throw err;
    }
  }

  /**
   * Lists orders for the authenticated customer.
   * Strictly filtered by user's own userId.
   */
  async listCustomerOrders(
    userId: string,
    query: OrderFilterDto,
  ): Promise<PaginatedResponse<OrderDto>> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = { userId };
    if (query.status) {
      where.status = query.status;
    }

    const [total, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include: {
          items: true,
          payments: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return {
      items: orders.map((o) => this.mapOrderToDto(o)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Retrieves an order for a customer.
   * Enforces customer ownership: returns 404 (not 403) to prevent ID enumeration.
   */
  async getCustomerOrder(userId: string, orderId: string): Promise<OrderDto> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        payments: true,
      },
    });

    if (!order || order.userId !== userId) {
      throw new NotFoundException(`Order '${orderId}' not found`);
    }

    return this.mapOrderToDto(order);
  }

  /**
   * Lists orders for admin / support.
   * Guarded by permissions guard (order.read).
   */
  async listAdminOrders(
    query: OrderFilterDto,
  ): Promise<PaginatedResponse<OrderDto>> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.userId) {
      where.userId = query.userId;
    }

    const [total, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include: {
          items: true,
          payments: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return {
      items: orders.map((o) => this.mapOrderToDto(o)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Retrieves any order for admin / support.
   * Guarded by permissions guard (order.read).
   */
  async getAdminOrder(orderId: string): Promise<OrderDto> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        payments: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Order '${orderId}' not found`);
    }

    return this.mapOrderToDto(order);
  }
}
