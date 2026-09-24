import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { TicketsService } from "./tickets.service";
import {
  ReplyTicketDto,
  AdminUpdateTicketDto,
  QueryTicketsDto,
} from "./dto/tickets.dto";
import { TicketDto, TicketMessageDto } from "@nexus/contracts";

@Controller(["admin/tickets", "v1/admin/tickets"])
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminTicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  @RequirePermissions("ticket.read")
  async adminListTickets(
    @Query() query: QueryTicketsDto,
  ): Promise<{ items: TicketDto[]; total: number }> {
    return this.ticketsService.adminListTickets(query);
  }

  @Get(":id")
  @RequirePermissions("ticket.read")
  async adminGetTicket(@Param("id") id: string): Promise<TicketDto> {
    return this.ticketsService.adminGetTicket(id);
  }

  @Patch(":id")
  @RequirePermissions("ticket.manage")
  async adminUpdateTicket(
    @Param("id") id: string,
    @Body() dto: AdminUpdateTicketDto,
  ): Promise<TicketDto> {
    return this.ticketsService.adminUpdateTicket(id, dto);
  }

  @Post(":id/reply")
  @RequirePermissions("ticket.manage")
  async adminReplyTicket(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: ReplyTicketDto,
  ): Promise<TicketMessageDto> {
    const staffUserId = req.user.id || req.user.sub;
    return this.ticketsService.adminReplyTicket(staffUserId, id, dto);
  }
}
