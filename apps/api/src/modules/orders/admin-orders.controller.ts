import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { OrdersService } from "./orders.service";
import { OrderFilterDto } from "./dto/orders.dto";
import { OrderDto, PaginatedResponse } from "@nexus/contracts";

@Controller("admin/orders")
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @RequirePermissions("order.read")
  async listOrders(
    @Query() query: OrderFilterDto,
  ): Promise<PaginatedResponse<OrderDto>> {
    return this.ordersService.listAdminOrders(query);
  }

  @Get(":id")
  @RequirePermissions("order.read")
  async getOrder(@Param("id") id: string): Promise<OrderDto> {
    return this.ordersService.getAdminOrder(id);
  }
}
