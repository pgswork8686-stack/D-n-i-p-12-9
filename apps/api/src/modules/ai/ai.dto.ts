import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from "class-validator";

export class CreateContextVersionDto {
  @IsIn(["ORGANIZATION", "CLIENT"])
  scope!: "ORGANIZATION" | "CLIENT";

  @IsUUID("4")
  tenantId!: string;

  @IsObject()
  content!: Record<string, unknown>;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  changeReason!: string;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  baseVersion!: number;
}

export class CreateExecutionDto {
  @IsIn(["weekly-marketing-review"])
  workflow!: "weekly-marketing-review";

  @IsUUID("4")
  tenantId!: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  weekEnding?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9:_.-]{8,120}$/)
  idempotencyKey?: string;
}

export class RequestActionDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_.]{2,63}$/)
  tool!: string;

  @IsObject()
  payload!: Record<string, unknown>;
}

export class DecideApprovalDto {
  @IsIn(["APPROVED", "REJECTED"])
  decision!: "APPROVED" | "REJECTED";

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class TenantQueryDto {
  @IsUUID("4")
  tenantId!: string;

  @IsOptional()
  @IsIn(["PENDING", "APPROVED", "REJECTED"])
  status?: "PENDING" | "APPROVED" | "REJECTED";
}
