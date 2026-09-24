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
import { FinanceService } from "./finance.service";
import {
  CalculateTaxDto,
  QueryInvoicesDto,
} from "./dto/finance.dto";
import {
  InvoiceDto,
  TaxCalculationResponse,
} from "@nexus/contracts";

@Controller(["finance", "v1/finance"])
@UseGuards(AuthGuard)
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Post("calculate-tax")
  async calculateTax(
    @Body() dto: CalculateTaxDto,
  ): Promise<TaxCalculationResponse> {
    return this.financeService.calculateTax(dto);
  }

  @Get("invoices")
  async listMyInvoices(
    @Req() req: any,
    @Query() query: QueryInvoicesDto,
  ): Promise<{ items: InvoiceDto[]; total: number }> {
    const userId = req.user.id || req.user.sub;
    return this.financeService.listMyInvoices(userId, query);
  }

  @Get("invoices/:id")
  async getMyInvoice(
    @Req() req: any,
    @Param("id") id: string,
  ): Promise<InvoiceDto> {
    const userId = req.user.id || req.user.sub;
    return this.financeService.getMyInvoice(userId, id);
  }
}
