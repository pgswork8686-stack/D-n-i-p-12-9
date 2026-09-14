import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  IsEnum,
} from "class-validator";
import { Type } from "class-transformer";
import {
  AllocationStatus,
  ProviderAccountStatus,
} from "@nexus/contracts";

export class RequestAllocationDto {
  @IsString()
  @IsNotEmpty()
  domain!: string;
}

export class CustomerRequestDeactivationDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class AdminActivateAllocationDto {
  @IsString()
  @IsNotEmpty()
  providerAccountId!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class AdminRejectAllocationDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class AdminRequestDeactivationDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class AdminConfirmDeactivatedDto {
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateProviderAccountDto {
  @IsString()
  @IsNotEmpty()
  providerId!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsInt()
  @Min(1)
  totalCapacity!: number;


  @IsOptional()
  @IsString()
  externalReference?: string;

  @IsOptional()
  @IsEnum(["ACTIVE", "EXHAUSTED", "SUSPENDED"])
  status?: ProviderAccountStatus;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class UpdateProviderAccountDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  totalCapacity?: number;

  @IsOptional()
  @IsString()
  externalReference?: string;

  @IsOptional()
  @IsEnum(["ACTIVE", "EXHAUSTED", "SUSPENDED"])
  status?: ProviderAccountStatus;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class AdminAllocationFilterDto {
  @IsOptional()
  @IsEnum(["PENDING", "ACTIVE", "DEACTIVATION_PENDING", "DEACTIVATED", "REJECTED"])
  status?: AllocationStatus;

  @IsOptional()
  @IsString()
  providerId?: string;

  @IsOptional()
  @IsString()
  providerAccountId?: string;

  @IsOptional()
  @IsString()
  entitlementId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;
}
