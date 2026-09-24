import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { FinanceService } from "./finance.service";
import {
  QueryInvoicesDto,
  QueryLedgerDto,
  CreateManualInvoiceDto,
} from "./dto/finance.dto";
import {
  InvoiceDto,
  LedgerEntryDto,
  FinancialSummaryReportDto,
} from "@nexus/contracts";

@Controller(["admin/finance", "v1/admin/finance"])
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminFinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get("ledger")
  @RequirePermissions("finance.read")
  async adminListLedger(
    @Query() query: QueryLedgerDto,
  ): Promise<{ items: LedgerEntryDto[]; total: number }> {
    return this.financeService.adminListLedger(query);
  }

  @Get("summary")
  @RequirePermissions("finance.read")
  async adminGetFinancialSummary(
    @Query("periodStart") periodStart?: string,
    @Query("periodEnd") periodEnd?: string,
  ): Promise<FinancialSummaryReportDto> {
    const start = periodStart ? new Date(periodStart) : undefined;
    const end = periodEnd ? new Date(periodEnd) : undefined;
    return this.financeService.adminGetFinancialSummary(start, end);
  }

  @Get("invoices")
  @RequirePermissions("invoice.read")
  async adminListInvoices(
    @Query() query: QueryInvoicesDto,
  ): Promise<{ items: InvoiceDto[]; total: number }> {
    return this.financeService.adminListInvoices(query);
  }

  @Get("invoices/:id")
  @RequirePermissions("invoice.read")
  async adminGetInvoice(@Param("id") id: string): Promise<InvoiceDto> {
    return this.financeService.adminGetInvoice(id);
  }

  @Post("invoices")
  @RequirePermissions("finance.manage")
  async adminCreateManualInvoice(
    @Body() dto: CreateManualInvoiceDto,
  ): Promise<InvoiceDto> {
    return this.financeService.createManualInvoice(dto);
  }
}
