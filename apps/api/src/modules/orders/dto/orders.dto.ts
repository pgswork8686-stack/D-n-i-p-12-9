import { IsEnum, IsOptional, IsString, IsInt, Min } from "class-validator";
import { Type } from "class-transformer";
import { Currency, OrderStatus } from "@nexus/database";

export class CheckoutDto {
  @IsEnum(Currency)
  currency!: Currency;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class OrderFilterDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsString()
  userId?: string;
}
