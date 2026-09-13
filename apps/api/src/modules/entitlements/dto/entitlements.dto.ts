import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from "class-validator";
import { Type } from "class-transformer";
import {
  EntitlementStatus,
  FulfillmentType,
  ProductType,
} from "@nexus/database";

export class EntitlementFilterDto {
  @IsOptional()
  @IsEnum(EntitlementStatus)
  status?: EntitlementStatus;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillmentType?: FulfillmentType;

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

export class AdminEntitlementFilterDto extends EntitlementFilterDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  orderId?: string;
}

export class RevokeEntitlementDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
