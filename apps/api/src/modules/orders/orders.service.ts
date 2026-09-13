import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import {
  prisma,
  Order,
  OrderItem,
  Payment,
  Currency,
  OrderStatus,
  ProductStatus,
  VariantStatus,
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
   * Authoritative checkout:
   * 1. Reloads user's active cart.
   * 2. Reloads all product, variant, and active price records.
   * 3. Authoritatively computes totals in minor units.
   * 4. In an atomic transaction:
   *    - Creates Order (PENDING_PAYMENT)
   *    - Creates immutable OrderItem snapshots
   *    - Creates Payment (PENDING)
   *    - Converts Cart
   * 5. Emits audit log.
   */
  async checkout(userId: string, dto: CheckoutDto): Promise<CheckoutResponse> {
    // Idempotency check if key provided
    if (dto.idempotencyKey) {
      const existingKey = await prisma.idempotencyKey.findUnique({
        where: { key: dto.idempotencyKey },
      });
      if (existingKey && existingKey.response) {
        this.logger.log(`Idempotent checkout hit for key '${dto.idempotencyKey}'`);
        return existingKey.response as unknown as CheckoutResponse;
      }
    }

    const cart = await prisma.cart.findFirst({
      where: { userId, status: "ACTIVE" },
      include: {
        items: {
          include: {
            variant: {
              include: {
                product: true,
                prices: {
                  where: {
                    currency: dto.currency,
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

    // Authoritative validation of every item in cart
    for (const item of cart.items) {
      const variant = item.variant;
      if (!variant || variant.status !== VariantStatus.ACTIVE) {
        throw new BadRequestException(
          `Cannot checkout: Variant '${variant?.sku || item.variantId}' is not active`,
        );
      }
      if (!variant.product || variant.product.status !== ProductStatus.ACTIVE) {
        throw new BadRequestException(
          `Cannot checkout: Product '${variant.product?.slug || variant.productId}' is not active`,
        );
      }
      if (!variant.prices || variant.prices.length === 0) {
        throw new BadRequestException(
          `Cannot checkout: Variant '${variant.sku}' has no active price in currency '${dto.currency}'`,
        );
      }
    }

    // Authoritative repricing calculation
    let subtotalAmount = 0;
    const itemsSnapshotData = cart.items.map((item) => {
      const variant = item.variant;
      const product = variant.product;
      const activePrice = variant.prices[0];

      const unitAmount = activePrice.amount;
      const lineTotalAmount = unitAmount * item.quantity;
      subtotalAmount += lineTotalAmount;

      return {
        productId: product.id,
        variantId: variant.id,
        productName: product.name,
        variantName: variant.name,
        sku: variant.sku,
        productType: product.productType,
        fulfillmentType: product.fulfillmentType,
        unitAmount,
        quantity: item.quantity,
        lineTotalAmount,
        currency: dto.currency,
      };
    });

    const discountAmount = 0;
    const totalAmount = subtotalAmount - discountAmount;
    const orderNumber = this.generateOrderNumber();

    // Atomic transaction
    const result = await prisma.$transaction(async (tx) => {
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

      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          provider: "TEST",
          status: "PENDING",
          amount: totalAmount,
          currency: dto.currency,
        },
      });

      await tx.cart.update({
        where: { id: cart.id },
        data: { status: "CONVERTED" },
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
        await tx.idempotencyKey.upsert({
          where: { key: dto.idempotencyKey },
          update: { response: response as any },
          create: {
            key: dto.idempotencyKey,
            scope: "checkout",
            response: response as any,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
      }

      return response;
    });

    await this.auditService.logAction({
      action: "ORDER_CREATED",
      entity: "Order",
      entityId: result.order.id,
      actorId: userId,
      details: {
        orderNumber: result.order.orderNumber,
        totalAmount: result.order.totalAmount,
        currency: result.order.currency,
        itemCount: result.order.items.length,
      },
    });

    this.logger.log(
      `Order ${result.order.orderNumber} created for user ${userId}, total: ${result.order.totalAmount} ${result.order.currency}`,
    );

    return result;
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
   * Enforces customer ownership: throws ForbiddenException if order belongs to another user.
   */
  async getCustomerOrder(userId: string, orderId: string): Promise<OrderDto> {
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

    if (order.userId !== userId) {
      throw new ForbiddenException("Cannot access orders belonging to another user");
    }

    return this.mapOrderToDto(order);
  }

  /**
   * Lists orders for admin / support.
   * Guarded by permissions guard (order.read).
   */
  async listAdminOrders(query: OrderFilterDto): Promise<PaginatedResponse<OrderDto>> {
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
