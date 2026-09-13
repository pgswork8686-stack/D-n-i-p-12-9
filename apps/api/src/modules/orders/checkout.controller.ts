import { Controller, Post, Body, UseGuards, Req } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { OrdersService } from "./orders.service";
import { CheckoutDto } from "./dto/orders.dto";
import { CheckoutResponse } from "@nexus/contracts";

@Controller("checkout")
@UseGuards(AuthGuard)
export class CheckoutController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  async checkout(
    @Req() req: any,
    @Body() dto: CheckoutDto,
  ): Promise<CheckoutResponse> {
    const userId = req.user.id;
    return this.ordersService.checkout(userId, dto);
  }
}
