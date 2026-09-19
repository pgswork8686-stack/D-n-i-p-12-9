import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  Min,
  Max,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import {
  AutomationJobStatus,
  AutomationJobType,
  AiDraftOutputContract,
} from "@nexus/contracts";

export class CreateAiDraftRequestDto {
  @IsString()
  @IsNotEmpty()
  topic!: string;

  @IsString()
  @IsNotEmpty()
  brief!: string;

  @IsString()
  @IsNotEmpty()
  language!: string;

  @IsString()
  @IsOptional()
  targetKeyword?: string;

  @IsString()
  @IsOptional()
  tone?: string;

  @IsString()
  @IsOptional()
  desiredLength?: string;
}

export class QueryAutomationJobsDto {
  @IsOptional()
  @IsString()
  status?: AutomationJobStatus;

  @IsOptional()
  @IsString()
  type?: AutomationJobType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class AutomationCallbackCompleteDto {
  @IsOptional()
  resultJson?: any;
}

export class AutomationCallbackFailDto {
  @IsString()
  @IsNotEmpty()
  errorCode!: string;

  @IsString()
  @IsNotEmpty()
  errorMessage!: string;

  @IsOptional()
  @IsBoolean()
  retryable?: boolean;
}

export class AiDraftOutputDto implements AiDraftOutputContract {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  excerpt!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100000)
  content!: string;

  @IsString()
  @IsNotEmpty()
  seoTitle!: string;

  @IsString()
  @IsNotEmpty()
  seoDescription!: string;

  @IsString()
  @IsNotEmpty()
  suggestedSlug!: string;
}

export class AutomationCallbackAiDraftResultDto {
  @IsString()
  @IsNotEmpty()
  jobId!: string;

  @ValidateNested()
  @Type(() => AiDraftOutputDto)
  result!: AiDraftOutputDto;
}
