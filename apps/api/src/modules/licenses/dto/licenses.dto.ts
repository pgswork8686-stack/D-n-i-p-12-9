import { IsNotEmpty, IsString, IsOptional, IsEnum } from "class-validator";
import {
  ActivateLicenseRequest,
  ValidateLicenseRequest,
  DeactivateLicenseRequest,
  AdminLicenseRevokeReason,
  AdminRevokeLicenseRequest,
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

export enum AdminLicenseRevokeReasonEnum {
  ADMINISTRATIVE = "ADMINISTRATIVE",
  REFUND = "REFUND",
  FRAUD = "FRAUD",
  SUPPORT = "SUPPORT",
  SECURITY = "SECURITY",
  OTHER = "OTHER",
}

export class AdminRevokeLicenseDto implements AdminRevokeLicenseRequest {
  @IsOptional()
  @IsEnum(AdminLicenseRevokeReasonEnum, {
    message:
      "reasonCode must be a valid AdminLicenseRevokeReason (ADMINISTRATIVE, REFUND, FRAUD, SUPPORT, SECURITY, OTHER)",
  })
  reasonCode?: AdminLicenseRevokeReason;
}

