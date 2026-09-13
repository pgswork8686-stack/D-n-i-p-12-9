import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Logger,
} from "@nestjs/common";
import {
  prisma,
  Cart,
  Currency,
  ProductStatus,
  VariantStatus,
} from "@nexus/database";
import { CartDto, CartItemDto } from "@nexus/contracts";
import { AddToCartDto } from "./dto/cart.dto";

const MAX_SAFE_AMOUNT = 2147483647; // PostgreSQL Int32 limit

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  /**
   * Retrieves or creates an active cart for the user.
   * Enforces at most one active cart per user, handling concurrent creation races safely.
   */
  async getOrCreateActiveCart(userId: string): Promise<Cart> {
    try {
      let cart = await prisma.cart.findFirst({
        where: { userId, status: "ACTIVE" },
      });

      if (!cart) {
        cart = await prisma.cart.create({
          data: {
            userId,
            status: "ACTIVE",
          },
        });
      }

      return cart;
    } catch (err: any) {
      if (
        err?.code === "P2002" ||
        err?.message?.includes("cart_user_active_unique")
      ) {
        const existing = await prisma.cart.findFirst({
          where: { userId, status: "ACTIVE" },
        });
        if (existing) return existing;
      }
      throw err;
    }
  }

  /**
   * Authoritatively computes cart totals and reprices all items against current catalog.
   * Uses deterministic price selection and enforces safe money bounds.
   */
  async getCart(
    userId: string,
    requestedCurrency: Currency = Currency.USD,
  ): Promise<CartDto> {
    const cart = await this.getOrCreateActiveCart(userId);

    const items = await prisma.cartItem.findMany({
      where: { cartId: cart.id },
      include: {
        price: true,
        variant: {
          include: {
            product: true,
            prices: {
              where: {
                currency: requestedCurrency,
                isActive: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    let subtotalAmount = 0;
    let itemCount = 0;

    const cartItemsDto: CartItemDto[] = items.map((item) => {
      const variant = item.variant;
      const product = variant.product;

      // Deterministic price resolution from item.price relation or fallback to variant prices
      let activePrice: any = item.price;
      if (!activePrice && item.priceId && variant?.prices) {
        activePrice =
          variant.prices.find((p: any) => p.id === item.priceId) || null;
      }
      if (!activePrice && variant?.prices && variant.prices.length > 0) {
        activePrice = variant.prices[0];
      }

      const unitAmount = activePrice ? activePrice.amount : 0;
      const lineTotalAmount = unitAmount * item.quantity;

      if (
        !Number.isSafeInteger(lineTotalAmount) ||
        lineTotalAmount > MAX_SAFE_AMOUNT
      ) {
        throw new BadRequestException(
          "Line total exceeds maximum allowable currency bounds",
        );
      }

      subtotalAmount += lineTotalAmount;
      if (
        !Number.isSafeInteger(subtotalAmount) ||
        subtotalAmount > MAX_SAFE_AMOUNT
      ) {
        throw new BadRequestException(
          "Subtotal exceeds maximum allowable currency bounds",
        );
      }

      itemCount += item.quantity;

      return {
        id: item.id,
        cartId: item.cartId,
        variantId: item.variantId,
        priceId: item.priceId,
        productId: product.id,
        productName: product.name,
        variantName: variant.name,
        sku: variant.sku,
        productType: product.productType,
        fulfillmentType: product.fulfillmentType,
        quantity: item.quantity,
        unitAmount,
        lineTotalAmount,
        currency: activePrice ? activePrice.currency : requestedCurrency,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      };
    });

    return {
      id: cart.id,
      userId: cart.userId,
      status: cart.status,
      currency: requestedCurrency,
      subtotalAmount,
      totalAmount: subtotalAmount,
      itemCount,
      items: cartItemsDto,
      createdAt: cart.createdAt.toISOString(),
      updatedAt: cart.updatedAt.toISOString(),
    };
  }

  /**
   * Adds an item to the user's active cart.
   * Validates Product is ACTIVE, Variant is ACTIVE, and active price exists for requested currency.
   * Prevents mutation on converted or inactive cart via transaction check.
   */
  async addItem(userId: string, dto: AddToCartDto): Promise<CartDto> {
    const currency = dto.currency || Currency.USD;

    if (
      !Number.isInteger(dto.quantity) ||
      dto.quantity < 1 ||
      dto.quantity > 999
    ) {
      throw new BadRequestException(
        "Quantity must be an integer between 1 and 999",
      );
    }

    const variant = await prisma.productVariant.findUnique({
      where: { id: dto.variantId },
      include: {
        product: true,
        prices: {
          where: {
            currency,
            isActive: true,
          },
        },
      },
    });

    if (!variant || variant.status !== VariantStatus.ACTIVE) {
      throw new BadRequestException("Variant is not active or does not exist");
    }

    if (!variant.product || variant.product.status !== ProductStatus.ACTIVE) {
      throw new BadRequestException("Product is not active or does not exist");
    }

    if (!variant.prices || variant.prices.length === 0) {
      throw new BadRequestException(
        `No active price found for variant '${variant.sku}' in currency '${currency}'`,
      );
    }

    // Deterministic price selection / validation
    let resolvedPriceId: string;
    if (dto.priceId) {
      const matched = variant.prices.find((p) => p.id === dto.priceId);
      if (!matched) {
        throw new BadRequestException(
          `Specified priceId '${dto.priceId}' is not active or does not belong to variant '${variant.sku}' in '${currency}'`,
        );
      }
      resolvedPriceId = matched.id;
    } else {
      if (variant.prices.length === 1) {
        resolvedPriceId = variant.prices[0].id;
      } else {
        const oneTimePrices = variant.prices.filter(
          (p) => p.billingType === "ONE_TIME",
        );
        if (oneTimePrices.length === 1) {
          resolvedPriceId = oneTimePrices[0].id;
        } else {
          throw new BadRequestException(
            `Multiple active prices exist for variant '${variant.sku}' in currency '${currency}'. Explicit priceId is required.`,
          );
        }
      }
    }

    const targetCart = dto.cartId
      ? await prisma.cart.findUnique({ where: { id: dto.cartId } })
      : await this.getOrCreateActiveCart(userId);

    if (!targetCart) {
      throw new NotFoundException("Cart not found");
    }
    if (targetCart.userId !== userId) {
      throw new ForbiddenException(
        "Cannot modify items in another user's cart",
      );
    }
    if (targetCart.status !== "ACTIVE") {
      throw new ConflictException(
        "Cart has already been checked out or is no longer active",
      );
    }

    await prisma.$transaction(async (tx) => {
      const currentCart = await tx.cart.findUnique({
        where: { id: targetCart.id },
      });
      if (!currentCart || currentCart.status !== "ACTIVE") {
        throw new ConflictException(
          "Cart has already been checked out or is no longer active",
        );
      }

      const existingItem = await tx.cartItem.findUnique({
        where: {
          cartId_variantId_priceId: {
            cartId: targetCart.id,
            variantId: variant.id,
            priceId: resolvedPriceId,
          },
        },
      });

      const newQuantity = (existingItem?.quantity || 0) + dto.quantity;
      if (newQuantity > 999) {
        throw new BadRequestException("Total item quantity cannot exceed 999");
      }

      await tx.cartItem.upsert({
        where: {
          cartId_variantId_priceId: {
            cartId: targetCart.id,
            variantId: variant.id,
            priceId: resolvedPriceId,
          },
        },
        update: {
          quantity: newQuantity,
        },
        create: {
          cartId: targetCart.id,
          variantId: variant.id,
          priceId: resolvedPriceId,
          quantity: dto.quantity,
        },
      });
    });

    this.logger.log(
      `User ${userId} added variant ${variant.sku} (price: ${resolvedPriceId}, qty: ${dto.quantity}) to cart ${targetCart.id}`,
    );

    return this.getCart(userId, currency);
  }

  /**
   * Updates an item's quantity in the user's active cart.
   * Enforces customer ownership and prevents modifying items of converted carts.
   */
  async updateItem(
    userId: string,
    itemId: string,
    quantity: number,
    currency: Currency = Currency.USD,
  ): Promise<CartDto> {
    await prisma.$transaction(async (tx) => {
      const cartItem = await tx.cartItem.findUnique({
        where: { id: itemId },
        include: { cart: true },
      });

      if (!cartItem) {
        throw new NotFoundException(`Cart item '${itemId}' not found`);
      }

      if (cartItem.cart.userId !== userId) {
        throw new ForbiddenException(
          "Cannot modify items in another user's cart",
        );
      }

      if (cartItem.cart.status !== "ACTIVE") {
        throw new ConflictException(
          "Cart has already been checked out or is no longer active",
        );
      }

      if (quantity > 999) {
        throw new BadRequestException("Quantity cannot exceed 999");
      }

      if (quantity <= 0) {
        await tx.cartItem.delete({
          where: { id: itemId },
        });
      } else {
        await tx.cartItem.update({
          where: { id: itemId },
          data: { quantity },
        });
      }
    });

    return this.getCart(userId, currency);
  }

  /**
   * Removes an item from the user's active cart.
   * Enforces customer ownership and prevents modifying items of converted carts.
   */
  async removeItem(
    userId: string,
    itemId: string,
    currency: Currency = Currency.USD,
  ): Promise<CartDto> {
    await prisma.$transaction(async (tx) => {
      const cartItem = await tx.cartItem.findUnique({
        where: { id: itemId },
        include: { cart: true },
      });

      if (!cartItem) {
        throw new NotFoundException(`Cart item '${itemId}' not found`);
      }

      if (cartItem.cart.userId !== userId) {
        throw new ForbiddenException(
          "Cannot modify items in another user's cart",
        );
      }

      if (cartItem.cart.status !== "ACTIVE") {
        throw new ConflictException(
          "Cart has already been checked out or is no longer active",
        );
      }

      await tx.cartItem.delete({
        where: { id: itemId },
      });
    });

    return this.getCart(userId, currency);
  }

  /**
   * Clears all items from the user's active cart.
   */
  async clearCart(userId: string): Promise<{ success: boolean }> {
    await prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findFirst({
        where: { userId, status: "ACTIVE" },
      });
      if (!cart) {
        return;
      }

      await tx.cartItem.deleteMany({
        where: { cartId: cart.id },
      });
    });

    return { success: true };
  }
}
