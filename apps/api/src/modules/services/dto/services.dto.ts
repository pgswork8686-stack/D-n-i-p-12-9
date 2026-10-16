import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Transform, Type } from "class-transformer";
import {
  ServiceDocumentVisibility,
  ServiceInquiryStatus,
  ServiceMilestoneStatus,
  ServicePricingMode,
  ServiceProjectMemberRole,
  ServiceProjectStatus,
  ServiceStatus,
} from "@nexus/database";
import {
  SERVICE_BUDGET_RANGES,
  SERVICE_TIMELINES,
  ServiceBudgetRange,
  ServiceTimeline,
} from "@nexus/contracts";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);
const lowerTrim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

/**
 * Multipart forms send booleans as strings. Only the exact values `true`/`"true"` and
 * `false`/`"false"` convert; anything else ("1", "yes", "on", numbers) stays as-is and fails
 * `@IsBoolean`, so consent can never be inferred from a loosely truthy value.
 */
const toStrictBoolean = ({ value }: { value: unknown }) => {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return value;
};

/**
 * Multipart forms send arrays either as repeated fields, a JSON array string or
 * a newline-separated string; normalise all of them to a trimmed string[].
 */
const toStringArray = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === "") return undefined;
  let items: unknown[];
  if (Array.isArray(value)) {
    items = value;
  } else if (typeof value === "string") {
    const raw = value.trim();
    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        items = Array.isArray(parsed) ? parsed : [raw];
      } catch {
        items = [raw];
      }
    } else {
      items = raw.split(/\r?\n/);
    }
  } else {
    return value;
  }
  return items
    .map((v) => (typeof v === "string" ? v.trim() : v))
    .filter((v) => v !== "");
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export class ServiceProcessStepDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(600)
  description!: string;
}

export class CreateServiceDto {
  @Transform(lowerTrim)
  @IsString()
  @Matches(SLUG_PATTERN, { message: "slug must be lowercase letters, digits and dashes" })
  @MaxLength(100)
  slug!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  summary!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  description!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  features?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ServiceProcessStepDto)
  processSteps?: ServiceProcessStepDto[];

  @IsOptional()
  @IsUrl({ protocols: ["https"], require_protocol: true })
  @MaxLength(500)
  imageUrl?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  ctaLabel?: string;

  @IsOptional()
  @IsEnum(ServicePricingMode)
  pricingMode?: ServicePricingMode;

  @IsOptional()
  @IsUUID()
  productId?: string | null;

  @IsOptional()
  @IsEnum(ServiceStatus)
  status?: ServiceStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;
}

export class UpdateServiceDto {
  @IsOptional()
  @Transform(lowerTrim)
  @IsString()
  @Matches(SLUG_PATTERN, { message: "slug must be lowercase letters, digits and dashes" })
  @MaxLength(100)
  slug?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  summary?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  features?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ServiceProcessStepDto)
  processSteps?: ServiceProcessStepDto[];

  @IsOptional()
  @IsUrl({ protocols: ["https"], require_protocol: true })
  @MaxLength(500)
  imageUrl?: string | null;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  ctaLabel?: string;

  @IsOptional()
  @IsEnum(ServicePricingMode)
  pricingMode?: ServicePricingMode;

  @IsOptional()
  @IsUUID()
  productId?: string | null;

  @IsOptional()
  @IsEnum(ServiceStatus)
  status?: ServiceStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;
}

// ---------------------------------------------------------------------------
// Inquiries
// ---------------------------------------------------------------------------

export class CreateServiceInquiryDto {
  @Transform(lowerTrim)
  @IsString()
  @Matches(SLUG_PATTERN)
  @MaxLength(100)
  serviceSlug!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  companyName!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  contactName!: string;

  @Transform(lowerTrim)
  @IsEmail()
  @MaxLength(254)
  contactEmail!: string;

  @IsOptional()
  @Transform(trim)
  @Matches(/^\+?[0-9 .()-]{8,20}$/, { message: "contactPhone is not a valid phone number" })
  contactPhone?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  requirements!: string;

  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  desiredFeatures?: string[];

  @IsOptional()
  @IsIn(SERVICE_BUDGET_RANGES as unknown as string[])
  budgetRange?: ServiceBudgetRange;

  @IsOptional()
  @IsIn(SERVICE_TIMELINES as unknown as string[])
  timeline?: ServiceTimeline;

  @IsOptional()
  @IsUUID()
  submissionKey?: string;

  /** Consent to process the data in this request. Required and must be exactly true. */
  @Transform(toStrictBoolean)
  @IsBoolean({ message: "consentAccepted must be a boolean" })
  consentAccepted!: boolean;

  /** Echo of the version shown to the customer; compared with the server's current version. */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  consentVersion!: string;

  /** Independent opt-in; absent means false. */
  @IsOptional()
  @Transform(toStrictBoolean)
  @IsBoolean({ message: "marketingConsent must be a boolean" })
  marketingConsent?: boolean;

  /** Honeypot: humans never see this field. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  website?: string;
}

export class QueryServiceListDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;

  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class AdminUpdateInquiryDto {
  @IsOptional()
  @IsEnum(ServiceInquiryStatus)
  status?: ServiceInquiryStatus;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  staffNote?: string | null;
}

export class ConvertInquiryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  summary?: string;

  @IsOptional()
  @Transform(lowerTrim)
  @IsEmail()
  @MaxLength(254)
  customerEmail?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  targetDate?: string;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export class AdminUpdateProjectDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  summary?: string | null;

  @IsOptional()
  @IsEnum(ServiceProjectStatus)
  status?: ServiceProjectStatus;

  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @IsOptional()
  @IsDateString()
  targetDate?: string | null;
}

export class AssignProjectMemberDto {
  @IsUUID()
  userId!: string;

  @IsOptional()
  @IsEnum(ServiceProjectMemberRole)
  role?: ServiceProjectMemberRole;
}

export class CreateMilestoneDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class UpdateMilestoneDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsEnum(ServiceMilestoneStatus)
  status?: ServiceMilestoneStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class PostProjectMessageDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  isInternalNote?: boolean;
}

export class UploadProjectDocumentDto {
  @IsOptional()
  @IsEnum(ServiceDocumentVisibility)
  visibility?: ServiceDocumentVisibility;
}
