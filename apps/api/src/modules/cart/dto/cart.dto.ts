import { IsString, IsInt, Min, IsOptional, IsEnum } from "class-validator";
import { Currency } from "@nexus/database";

export class AddToCartDto {
  @IsString()
  variantId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;
}

export class UpdateCartItemDto {
  @IsInt()
  quantity!: number;
}
