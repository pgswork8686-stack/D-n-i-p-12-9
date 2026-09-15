import {
  IsBoolean,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
} from "class-validator";
import { Transform } from "class-transformer";
import {
  CreateProductVersionRequest,
  RequestDownloadRequest,
  CheckUpdateRequest,
} from "@nexus/contracts";

export class CreateProductVersionDto implements CreateProductVersionRequest {
  @IsString()
  @IsNotEmpty()
  version!: string;

  @IsString()
  @IsOptional()
  releaseNotes?: string;
}


export class UploadVersionFileDto {
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === "true" || value === true || value === 1 || value === "1")
  isPrimary?: boolean;
}

export class RequestDownloadDto implements RequestDownloadRequest {
  @IsUUID()
  @IsNotEmpty()
  entitlementId!: string;

  @IsUUID()
  @IsNotEmpty()
  versionId!: string;

  @IsUUID()
  @IsNotEmpty()
  fileId!: string;
}

export class CheckUpdateDto implements CheckUpdateRequest {
  @IsString()
  @IsNotEmpty()
  licenseKey!: string;

  @IsString()
  @IsNotEmpty()
  domain!: string;

  @IsUUID()
  @IsNotEmpty()
  productId!: string;

  @IsString()
  @IsNotEmpty()
  currentVersion!: string;
}
