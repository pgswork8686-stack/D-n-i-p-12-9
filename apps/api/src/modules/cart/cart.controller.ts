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
import { AddToCartDto, UpdateCartItemDto, CartQueryDto } from "./dto/cart.dto";
import { CartDto } from "@nexus/contracts";

@Controller("cart")
@UseGuards(AuthGuard)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  async getCart(
    @Req() req: any,
    @Query() query: CartQueryDto,
  ): Promise<CartDto> {
    const userId = req.user.id;
    return this.cartService.getCart(userId, query?.currency);
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
    @Query() query: CartQueryDto,
  ): Promise<CartDto> {
    const userId = req.user.id;
    return this.cartService.updateItem(
      userId,
      itemId,
      dto.quantity,
      query?.currency,
    );
  }

  @Delete("items/:itemId")
  async removeItem(
    @Req() req: any,
    @Param("itemId") itemId: string,
    @Query() query: CartQueryDto,
  ): Promise<CartDto> {
    const userId = req.user.id;
    return this.cartService.removeItem(userId, itemId, query?.currency);
  }

  @Delete()
  async clearCart(@Req() req: any): Promise<{ success: boolean }> {
    const userId = req.user.id;
    return this.cartService.clearCart(userId);
  }
}
