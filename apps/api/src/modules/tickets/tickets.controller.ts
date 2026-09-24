import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { TicketsService } from "./tickets.service";
import {
  CreateTicketDto,
  ReplyTicketDto,
  QueryTicketsDto,
} from "./dto/tickets.dto";
import { TicketDto, TicketMessageDto } from "@nexus/contracts";

@Controller(["tickets", "v1/tickets"])
@UseGuards(AuthGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  async listMyTickets(
    @Req() req: any,
    @Query() query: QueryTicketsDto,
  ): Promise<{ items: TicketDto[]; total: number }> {
    const userId = req.user.id || req.user.sub;
    return this.ticketsService.listMyTickets(userId, query);
  }

  @Post()
  async createTicket(
    @Req() req: any,
    @Body() dto: CreateTicketDto,
  ): Promise<TicketDto> {
    const userId = req.user.id || req.user.sub;
    return this.ticketsService.createTicket(userId, dto);
  }

  @Get(":id")
  async getMyTicket(
    @Req() req: any,
    @Param("id") id: string,
  ): Promise<TicketDto> {
    const userId = req.user.id || req.user.sub;
    return this.ticketsService.getMyTicket(userId, id);
  }

  @Post(":id/reply")
  async replyTicket(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: ReplyTicketDto,
  ): Promise<TicketMessageDto> {
    const userId = req.user.id || req.user.sub;
    return this.ticketsService.replyTicket(userId, id, dto);
  }
}
