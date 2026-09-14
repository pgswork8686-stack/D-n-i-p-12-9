import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsNumber,
  IsPositive,
} from "class-validator";
import {
  CreateProductVersionRequest,
  AddVersionFileRequest,
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

export class AddVersionFileDto implements AddVersionFileRequest {
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsOptional()
  contentType?: string;

  @IsString()
  @IsOptional()
  storageKey?: string;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  sizeBytes?: number;

  @IsString()
  @IsOptional()
  sha256?: string;
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
