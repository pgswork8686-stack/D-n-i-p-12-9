import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
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

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  /**
   * Retrieves or creates an active cart for the user.
   */
  async getOrCreateActiveCart(userId: string): Promise<Cart> {
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
  }

  /**
   * Authoritatively computes cart totals and reprices all items against current catalog.
   */
  async getCart(userId: string, requestedCurrency: Currency = Currency.USD): Promise<CartDto> {
    const cart = await this.getOrCreateActiveCart(userId);

    const items = await prisma.cartItem.findMany({
      where: { cartId: cart.id },
      include: {
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
      const activePrice = variant.prices[0];

      const unitAmount = activePrice ? activePrice.amount : 0;
      const lineTotalAmount = unitAmount * item.quantity;

      subtotalAmount += lineTotalAmount;
      itemCount += item.quantity;

      return {
        id: item.id,
        cartId: item.cartId,
        variantId: item.variantId,
        productId: product.id,
        productName: product.name,
        variantName: variant.name,
        sku: variant.sku,
        productType: product.productType,
        fulfillmentType: product.fulfillmentType,
        quantity: item.quantity,
        unitAmount,
        lineTotalAmount,
        currency: requestedCurrency,
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
   */
  async addItem(userId: string, dto: AddToCartDto): Promise<CartDto> {
    const currency = dto.currency || Currency.USD;

    if (dto.quantity < 1) {
      throw new BadRequestException("Quantity must be at least 1");
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

    const cart = await this.getOrCreateActiveCart(userId);

    await prisma.cartItem.upsert({
      where: {
        cartId_variantId: {
          cartId: cart.id,
          variantId: variant.id,
        },
      },
      update: {
        quantity: { increment: dto.quantity },
      },
      create: {
        cartId: cart.id,
        variantId: variant.id,
        quantity: dto.quantity,
      },
    });

    this.logger.log(
      `User ${userId} added variant ${variant.sku} (qty: ${dto.quantity}) to cart ${cart.id}`,
    );

    return this.getCart(userId, currency);
  }

  /**
   * Updates an item's quantity in the user's active cart.
   * Enforces customer ownership.
   */
  async updateItem(
    userId: string,
    itemId: string,
    quantity: number,
    currency: Currency = Currency.USD,
  ): Promise<CartDto> {
    const cart = await this.getOrCreateActiveCart(userId);

    const cartItem = await prisma.cartItem.findUnique({
      where: { id: itemId },
      include: { cart: true },
    });

    if (!cartItem) {
      throw new NotFoundException(`Cart item '${itemId}' not found`);
    }

    if (cartItem.cartId !== cart.id || cartItem.cart.userId !== userId) {
      throw new ForbiddenException("Cannot modify items in another user's cart");
    }

    if (quantity <= 0) {
      await prisma.cartItem.delete({
        where: { id: itemId },
      });
    } else {
      await prisma.cartItem.update({
        where: { id: itemId },
        data: { quantity },
      });
    }

    return this.getCart(userId, currency);
  }

  /**
   * Removes an item from the user's active cart.
   * Enforces customer ownership.
   */
  async removeItem(
    userId: string,
    itemId: string,
    currency: Currency = Currency.USD,
  ): Promise<CartDto> {
    const cart = await this.getOrCreateActiveCart(userId);

    const cartItem = await prisma.cartItem.findUnique({
      where: { id: itemId },
      include: { cart: true },
    });

    if (!cartItem) {
      throw new NotFoundException(`Cart item '${itemId}' not found`);
    }

    if (cartItem.cartId !== cart.id || cartItem.cart.userId !== userId) {
      throw new ForbiddenException("Cannot modify items in another user's cart");
    }

    await prisma.cartItem.delete({
      where: { id: itemId },
    });

    return this.getCart(userId, currency);
  }

  /**
   * Clears all items from the user's active cart.
   */
  async clearCart(userId: string): Promise<{ success: boolean }> {
    const cart = await this.getOrCreateActiveCart(userId);

    await prisma.cartItem.deleteMany({
      where: { cartId: cart.id },
    });

    return { success: true };
  }
}
