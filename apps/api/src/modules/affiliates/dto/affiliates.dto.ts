import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsUUID,
  IsInt,
  Min,
  Max,
  IsObject,
  IsIn,
} from "class-validator";
import { Type } from "class-transformer";
import {
  AffiliateStatus,
  PayoutStatus,
  PayoutMethod,
  ReferralStatus,
} from "@nexus/database";
import {
  RegisterAffiliateRequest,
  AffiliateClickRequest,
  RequestPayoutRequest,
  AdminUpdateAffiliateStatusRequest,
  AdminUpdateCommissionRequest,
  AdminProcessPayoutRequest,
} from "@nexus/contracts";

export class RegisterAffiliateDto implements RegisterAffiliateRequest {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsEnum(PayoutMethod)
  @IsOptional()
  payoutMethod?: PayoutMethod;

  @IsObject()
  @IsOptional()
  payoutDetails?: Record<string, unknown>;
}

export class RecordClickDto implements AffiliateClickRequest {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  landingPage!: string;

  @IsString()
  @IsOptional()
  referer?: string;

  @IsString()
  @IsOptional()
  utmSource?: string;

  @IsString()
  @IsOptional()
  utmCampaign?: string;
}

export class RequestPayoutDto implements RequestPayoutRequest {
  @IsInt()
  @Min(1)
  amountMinor!: number;

  @IsEnum(PayoutMethod)
  @IsOptional()
  payoutMethod?: PayoutMethod;

  @IsObject()
  @IsOptional()
  payoutDetails?: Record<string, unknown>;
}

export class AdminUpdateAffiliateStatusDto
  implements AdminUpdateAffiliateStatusRequest
{
  @IsEnum(AffiliateStatus)
  status!: AffiliateStatus;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class AdminUpdateCommissionDto implements AdminUpdateCommissionRequest {
  @IsInt()
  @Min(100) // 1.00%
  @Max(5000) // 50.00%
  commissionRateBp!: number;
}

export class AdminProcessPayoutDto implements AdminProcessPayoutRequest {
  @IsIn(["COMPLETED", "REJECTED"])
  status!: "COMPLETED" | "REJECTED";

  @IsString()
  @IsOptional()
  referenceCode?: string;

  @IsString()
  @IsOptional()
  rejectionReason?: string;
}

export class QueryAffiliatesDto {
  @IsOptional()
  @IsEnum(AffiliateStatus)
  status?: AffiliateStatus;

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

export class QueryReferralsDto {
  @IsOptional()
  @IsEnum(ReferralStatus)
  status?: ReferralStatus;

  @IsOptional()
  @IsUUID()
  affiliateId?: string;

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
