import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { OrdersService } from "./orders.service";
import { OrderFilterDto } from "./dto/orders.dto";
import { OrderDto, PaginatedResponse } from "@nexus/contracts";

@Controller("orders")
@UseGuards(AuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  async listOrders(
    @Req() req: any,
    @Query() query: OrderFilterDto,
  ): Promise<PaginatedResponse<OrderDto>> {
    const userId = req.user.id;
    return this.ordersService.listCustomerOrders(userId, query);
  }

  @Get(":id")
  async getOrder(
    @Req() req: any,
    @Param("id") id: string,
  ): Promise<OrderDto> {
    const userId = req.user.id;
    return this.ordersService.getCustomerOrder(userId, id);
  }
}
