import { IsString, IsInt, Min, Max, IsOptional, IsEnum } from "class-validator";
import { Currency } from "@nexus/database";

export class AddToCartDto {
  @IsOptional()
  @IsString()
  cartId?: string;

  @IsString()
  variantId!: string;

  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;

  @IsOptional()
  @IsString()
  priceId?: string;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;
}

export class UpdateCartItemDto {
  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;
}

export class CartQueryDto {
  @IsOptional()
  @IsEnum(Currency, { message: "Invalid currency. Allowed values: USD, VND" })
  currency?: Currency;
}
