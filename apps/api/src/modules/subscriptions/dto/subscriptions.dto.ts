import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsUUID,
  IsInt,
  Min,
  Max,
  IsBoolean,
  IsArray,
} from "class-validator";
import { Type } from "class-transformer";
import {
  SubscriptionTier,
  BillingInterval,
  SubscriptionStatus,
  Currency,
} from "@nexus/database";
import {
  CreateSubscriptionSessionRequest,
  CreatePortalSessionRequest,
  AdminCreatePlanRequest,
  AdminUpdatePlanRequest,
} from "@nexus/contracts";

export class CreateSubscriptionSessionDto
  implements CreateSubscriptionSessionRequest
{
  @IsUUID()
  @IsNotEmpty()
  planId!: string;

  @IsString()
  @IsNotEmpty()
  successUrl!: string;

  @IsString()
  @IsNotEmpty()
  cancelUrl!: string;
}

export class CreatePortalSessionDto implements CreatePortalSessionRequest {
  @IsString()
  @IsNotEmpty()
  returnUrl!: string;
}

export class AdminCreatePlanDto implements AdminCreatePlanRequest {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  slug!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(SubscriptionTier)
  tier!: SubscriptionTier;

  @IsEnum(BillingInterval)
  interval!: BillingInterval;

  @IsInt()
  @Min(0)
  priceMinor!: number;

  @IsEnum(Currency)
  currency!: Currency;

  @IsInt()
  @Min(1)
  @Max(10000)
  dailyDownloadQuota!: number;

  @IsInt()
  @IsOptional()
  @Min(1)
  maxActivationsPerProduct?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  features?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  stripePriceId?: string;
}

export class AdminUpdatePlanDto implements AdminUpdatePlanRequest {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(10000)
  dailyDownloadQuota?: number;

  @IsInt()
  @IsOptional()
  @Min(1)
  maxActivationsPerProduct?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  features?: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  stripePriceId?: string;
}

export class QuerySubscriptionsDto {
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;
}
