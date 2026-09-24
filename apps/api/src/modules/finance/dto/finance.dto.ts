import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsBoolean,
  IsArray,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import {
  Currency,
  LedgerAccountCode,
  InvoiceStatus,
} from "@nexus/database";
import {
  TaxCalculationRequest,
  QueryInvoicesRequest,
  QueryLedgerRequest,
} from "@nexus/contracts";

export class CalculateTaxDto implements TaxCalculationRequest {
  @IsInt()
  @Min(0)
  subtotalMinor!: number;

  @IsEnum(Currency)
  currency!: Currency;

  @IsString()
  @IsNotEmpty()
  countryCode!: string;

  @IsOptional()
  @IsString()
  stateCode?: string;

  @IsOptional()
  @IsBoolean()
  isB2B?: boolean;

  @IsOptional()
  @IsString()
  vatId?: string;
}

export class QueryInvoicesDto implements QueryInvoicesRequest {
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class QueryLedgerDto implements QueryLedgerRequest {
  @IsOptional()
  @IsEnum(LedgerAccountCode)
  accountCode?: LedgerAccountCode;

  @IsOptional()
  @IsString()
  referenceType?: string;

  @IsOptional()
  @IsString()
  referenceId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}

export class InvoiceItemInputDto {
  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsInt()
  @Min(0)
  unitPriceMinor!: number;
}

export class CreateManualInvoiceDto {
  @IsString()
  @IsNotEmpty()
  orderId!: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsString()
  @IsNotEmpty()
  customerName!: string;

  @IsString()
  @IsNotEmpty()
  customerEmail!: string;

  @IsOptional()
  @IsString()
  customerAddress?: string;

  @IsString()
  @IsNotEmpty()
  countryCode!: string;

  @IsOptional()
  @IsString()
  stateCode?: string;

  @IsOptional()
  @IsString()
  vatId?: string;

  @IsOptional()
  @IsBoolean()
  isB2B?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemInputDto)
  items!: InvoiceItemInputDto[];
}
