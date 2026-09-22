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
  @MaxLength(500)
  topic!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  brief!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  language!: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  targetKeyword?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  tone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  desiredLength?: string;
}

export class QueryAutomationJobsDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: AutomationJobStatus;

  @IsOptional()
  @IsString()
  @MaxLength(64)
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

/**
 * Narrow completion contract for notification jobs (§14): the generic
 * complete endpoint MUST NOT accept arbitrary unbounded JSON from n8n.
 */
export class EmailCompletionResultDto {
  @IsOptional()
  @IsBoolean()
  sent?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  providerMessageId?: string;
}

export class AutomationCallbackCompleteDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => EmailCompletionResultDto)
  resultJson?: EmailCompletionResultDto;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  providerMessageId?: string;
}

export class AutomationCallbackFailDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  errorCode!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  errorMessage!: string;

  @IsOptional()
  @IsBoolean()
  retryable?: boolean;
}

export class AiDraftOutputDto implements AiDraftOutputContract {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  excerpt!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100000)
  content!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  seoTitle!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  seoDescription!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
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
