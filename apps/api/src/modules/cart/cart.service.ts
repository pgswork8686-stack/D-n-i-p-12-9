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
import { lockCartById, lockActiveCartByUser } from "./cart-lock.helper";

const MAX_SAFE_AMOUNT = 2147483647; // PostgreSQL Int32 limit

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  /**
   * Retrieves or creates an active cart for the user.
   * Enforces at most one active cart per user, handling concurrent creation races safely.
   */
  async getOrCreateActiveCart(
    userId: string,
    initialCurrency: Currency = Currency.USD,
  ): Promise<Cart> {
    try {
      let cart = await prisma.cart.findFirst({
        where: { userId, status: "ACTIVE" },
      });

      if (!cart) {
        cart = await prisma.cart.create({
          data: {
            userId,
            status: "ACTIVE",
            currency: initialCurrency,
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
   * Excludes inactive or currency-mismatched items from totals and marks them isAvailable: false.
   */
  async getCart(
    userId: string,
    requestedCurrency?: Currency,
  ): Promise<CartDto> {
    const cart = await this.getOrCreateActiveCart(
      userId,
      requestedCurrency || Currency.USD,
    );

    const items = await prisma.cartItem.findMany({
      where: { cartId: cart.id },
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
    });

    let subtotalAmount = 0;
    let itemCount = 0;

    const cartItemsDto: CartItemDto[] = items.map((item) => {
      const variant = item.variant;
      const product = variant.product;

      // Deterministic price resolution
      let activePrice: any = item.price;
      if (!activePrice && item.priceId && variant?.prices) {
        activePrice =
          variant.prices.find((p: any) => p.id === item.priceId) || null;
      }
      if (!activePrice && !item.priceId && variant?.prices) {
        const matches = variant.prices.filter(
          (p: any) => p.currency === cart.currency && p.isActive,
        );
        if (matches.length === 1) {
          activePrice = matches[0];
        }
      }

      let isAvailable = true;
      let unavailableReason: string | null = null;

      if (!variant || variant.status !== VariantStatus.ACTIVE) {
        isAvailable = false;
        unavailableReason = "Variant is no longer active";
      } else if (!product || product.status !== ProductStatus.ACTIVE) {
        isAvailable = false;
        unavailableReason = "Product is no longer active";
      } else if (!activePrice) {
        isAvailable = false;
        unavailableReason = "Price not found";
      } else if (!activePrice.isActive) {
        isAvailable = false;
        unavailableReason = "Price is no longer active";
      } else if (activePrice.currency !== cart.currency) {
        isAvailable = false;
        unavailableReason = `Currency mismatch (cart is ${cart.currency}, item is ${activePrice.currency})`;
      }

      const unitAmount = activePrice ? activePrice.amount : 0;
      const lineTotalAmount = isAvailable ? unitAmount * item.quantity : 0;

      if (isAvailable) {
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
      }

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
        currency: activePrice ? activePrice.currency : cart.currency,
        isAvailable,
        unavailableReason,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      };
    });

    return {
      id: cart.id,
      userId: cart.userId,
      status: cart.status,
      currency: cart.currency,
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
   * Enforces row-level cart lock (SELECT FOR UPDATE) to linearize with concurrent checkouts.
   * Enforces single currency per cart: first item sets currency, subsequent items must match.
   */
  async addItem(userId: string, dto: AddToCartDto): Promise<CartDto> {
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

    let resolvedPrice: any;
    if (dto.priceId) {
      resolvedPrice = variant.prices.find((p) => p.id === dto.priceId);
      if (!resolvedPrice) {
        throw new BadRequestException(
          `Specified priceId '${dto.priceId}' is not active or does not belong to variant '${variant.sku}'`,
        );
      }
      if (dto.currency && resolvedPrice.currency !== dto.currency) {
        throw new BadRequestException(
          `Price currency '${resolvedPrice.currency}' does not match requested currency '${dto.currency}'`,
        );
      }
    } else {
      const currency = dto.currency || Currency.USD;
      const matchingPrices = variant.prices.filter((p) => p.currency === currency);
      if (matchingPrices.length === 0) {
        throw new BadRequestException(
          `No active price found for variant '${variant.sku}' in currency '${currency}'`,
        );
      }
      if (matchingPrices.length === 1) {
        resolvedPrice = matchingPrices[0];
      } else {
        const oneTimePrices = matchingPrices.filter(
          (p) => p.billingType === "ONE_TIME",
        );
        if (oneTimePrices.length === 1) {
          resolvedPrice = oneTimePrices[0];
        } else {
          throw new BadRequestException(
            `Multiple active prices exist for variant '${variant.sku}' in currency '${currency}'. Explicit priceId is required.`,
          );
        }
      }
    }

    const targetCart = dto.cartId
      ? await prisma.cart.findUnique({ where: { id: dto.cartId } })
      : await this.getOrCreateActiveCart(userId, resolvedPrice.currency);

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
      // Linearize all cart mutations using SELECT FOR UPDATE (fail closed)
      const currentCart = await lockCartById(tx, targetCart.id);

      if (!currentCart || currentCart.status !== "ACTIVE") {
        throw new ConflictException(
          "Cart has already been checked out or is no longer active",
        );
      }

      // Check existing items in cart
      const existingItems = await tx.cartItem.findMany({
        where: { cartId: targetCart.id },
      });

      if (existingItems.length === 0) {
        // First item in cart sets cart currency
        if (currentCart.currency !== resolvedPrice.currency) {
          await tx.cart.update({
            where: { id: targetCart.id },
            data: { currency: resolvedPrice.currency },
          });
          currentCart.currency = resolvedPrice.currency;
        }
      } else {
        // Cart is not empty: enforce single currency invariant
        if (currentCart.currency !== resolvedPrice.currency) {
          throw new BadRequestException(
            `Cart currency is ${currentCart.currency}. Cannot add item in ${resolvedPrice.currency}. Clear cart to change currency.`,
          );
        }
      }

      const existingItem = existingItems.find(
        (it) => it.variantId === variant.id && it.priceId === resolvedPrice.id,
      );

      const newQuantity = (existingItem?.quantity || 0) + dto.quantity;
      if (newQuantity > 999) {
        throw new BadRequestException("Total item quantity cannot exceed 999");
      }

      await tx.cartItem.upsert({
        where: {
          cartId_variantId_priceId: {
            cartId: targetCart.id,
            variantId: variant.id,
            priceId: resolvedPrice.id,
          },
        },
        update: {
          quantity: newQuantity,
        },
        create: {
          cartId: targetCart.id,
          variantId: variant.id,
          priceId: resolvedPrice.id,
          quantity: dto.quantity,
        },
      });
    });

    this.logger.log(
      `User ${userId} added variant ${variant.sku} (price: ${resolvedPrice.id}, qty: ${dto.quantity}) to cart ${targetCart.id}`,
    );

    return this.getCart(userId);
  }

  /**
   * Updates an item's quantity in the user's active cart.
   * Linearizes on cart row FOR UPDATE and prevents mutating checked-out carts.
   */
  async updateItem(
    userId: string,
    itemId: string,
    quantity: number,
    currency?: Currency,
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

      // Linearize on cart row FOR UPDATE (fail closed)
      const lockedCart = await lockCartById(tx, cartItem.cartId);

      if (!lockedCart || lockedCart.status !== "ACTIVE") {
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
   * Linearizes on cart row FOR UPDATE and prevents mutating checked-out carts.
   */
  async removeItem(
    userId: string,
    itemId: string,
    currency?: Currency,
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

      // Linearize on cart row FOR UPDATE (fail closed)
      const lockedCart = await lockCartById(tx, cartItem.cartId);

      if (!lockedCart || lockedCart.status !== "ACTIVE") {
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
   * Linearizes on cart row FOR UPDATE.
   */
  async clearCart(userId: string): Promise<{ success: boolean }> {
    await prisma.$transaction(async (tx) => {
      // Linearize on cart row FOR UPDATE (fail closed)
      const cart = await lockActiveCartByUser(tx, userId);

      if (!cart || cart.status !== "ACTIVE") {
        return;
      }

      await tx.cartItem.deleteMany({
        where: { cartId: cart.id },
      });
    });

    return { success: true };
  }
}
