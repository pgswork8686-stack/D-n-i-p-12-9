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
} from "class-validator";
import {
  HostingProvider,
  DnsRecordType,
} from "@nexus/database";

export class CreateHostingServerDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  hostname!: string;

  @IsEnum(HostingProvider)
  provider!: HostingProvider;

  @IsString()
  @IsNotEmpty()
  endpointUrl!: string;

  @IsString()
  @IsNotEmpty()
  ipAddress!: string;

  @IsString()
  @IsNotEmpty()
  apiToken!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxAccounts?: number;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class UpdateHostingServerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  hostname?: string;

  @IsOptional()
  @IsString()
  endpointUrl?: string;

  @IsOptional()
  @IsString()
  ipAddress?: string;

  @IsOptional()
  @IsString()
  apiToken?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxAccounts?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class CreateHostingAccountDto {
  @IsOptional()
  @IsString()
  serverId?: string;

  @IsString()
  @IsNotEmpty()
  domain!: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  packagePlan?: string;

  @IsOptional()
  @IsString()
  entitlementId?: string;

  @IsOptional()
  @IsString()
  orderId?: string;
}

export class CreateDnsRecordDto {
  @IsEnum(DnsRecordType)
  type!: DnsRecordType;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  ttl?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(65535)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  proxied?: boolean;
}

export class UpdateDnsRecordDto {
  @IsOptional()
  @IsEnum(DnsRecordType)
  type?: DnsRecordType;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  ttl?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(65535)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  proxied?: boolean;
}

export class PurgeCacheDto {
  @IsOptional()
  @IsBoolean()
  purgeEverything?: boolean;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsArray()
  hosts?: string[];
}

export class AdminSuspendAccountDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
