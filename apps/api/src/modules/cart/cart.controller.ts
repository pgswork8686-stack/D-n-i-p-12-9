import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { CartService } from "./cart.service";
import { AddToCartDto, UpdateCartItemDto } from "./dto/cart.dto";
import { Currency } from "@nexus/database";
import { CartDto } from "@nexus/contracts";

@Controller("cart")
@UseGuards(AuthGuard)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  async getCart(
    @Req() req: any,
    @Query("currency") currency?: Currency,
  ): Promise<CartDto> {
    const userId = req.user.id;
    return this.cartService.getCart(userId, currency);
  }

  @Post("items")
  async addItem(@Req() req: any, @Body() dto: AddToCartDto): Promise<CartDto> {
    const userId = req.user.id;
    return this.cartService.addItem(userId, dto);
  }

  @Patch("items/:itemId")
  async updateItem(
    @Req() req: any,
    @Param("itemId") itemId: string,
    @Body() dto: UpdateCartItemDto,
    @Query("currency") currency?: Currency,
  ): Promise<CartDto> {
    const userId = req.user.id;
    return this.cartService.updateItem(userId, itemId, dto.quantity, currency);
  }

  @Delete("items/:itemId")
  async removeItem(
    @Req() req: any,
    @Param("itemId") itemId: string,
    @Query("currency") currency?: Currency,
  ): Promise<CartDto> {
    const userId = req.user.id;
    return this.cartService.removeItem(userId, itemId, currency);
  }

  @Delete()
  async clearCart(@Req() req: any): Promise<{ success: boolean }> {
    const userId = req.user.id;
    return this.cartService.clearCart(userId);
  }
}
