import { IsNotEmpty, IsString, IsOptional } from "class-validator";
import {
  ActivateLicenseRequest,
  ValidateLicenseRequest,
  DeactivateLicenseRequest,
} from "@nexus/contracts";

export class ActivateLicenseDto implements ActivateLicenseRequest {
  @IsNotEmpty({ message: "licenseKey is required" })
  @IsString({ message: "licenseKey must be a string" })
  licenseKey!: string;

  @IsNotEmpty({ message: "domain is required" })
  @IsString({ message: "domain must be a string" })
  domain!: string;
}

export class ValidateLicenseDto implements ValidateLicenseRequest {
  @IsNotEmpty({ message: "licenseKey is required" })
  @IsString({ message: "licenseKey must be a string" })
  licenseKey!: string;

  @IsNotEmpty({ message: "domain is required" })
  @IsString({ message: "domain must be a string" })
  domain!: string;
}

export class DeactivateLicenseDto implements DeactivateLicenseRequest {
  @IsNotEmpty({ message: "licenseKey is required" })
  @IsString({ message: "licenseKey must be a string" })
  licenseKey!: string;

  @IsNotEmpty({ message: "domain is required" })
  @IsString({ message: "domain must be a string" })
  domain!: string;
}

export class AdminRevokeLicenseDto {
  @IsOptional()
  @IsString({ message: "reason must be a string" })
  reason?: string;
}
