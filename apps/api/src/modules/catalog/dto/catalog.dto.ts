import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsBoolean,
  IsArray,
  IsObject,
  Matches,
  MinLength,
  IsIn,
} from "class-validator";
import { Type } from "class-transformer";
import {
  ProductType,
  FulfillmentType,
  ProductStatus,
  VariantStatus,
  CategoryStatus,
  Currency,
  BillingType,
  BillingInterval,
} from "@nexus/database";

export class CreateProductDto {
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "Slug must be lowercase alphanumeric characters separated by single hyphens",
  })
  slug!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  shortDescription?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(ProductType, {
    message: `productType must be one of: ${Object.values(ProductType).join(", ")}`,
  })
  productType!: ProductType;

  @IsEnum(FulfillmentType, {
    message: `fulfillmentType must be one of: ${Object.values(FulfillmentType).join(", ")}`,
  })
  fulfillmentType!: FulfillmentType;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "Slug must be lowercase alphanumeric characters separated by single hyphens",
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  shortDescription?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(ProductType)
  productType?: ProductType;

  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillmentType?: FulfillmentType;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];
}

export class CreateVariantDto {
  @IsString()
  @MinLength(1)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: "SKU must contain only letters, numbers, hyphens, and underscores",
  })
  sku!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsEnum(VariantStatus)
  status?: VariantStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsString()
  licensePlanId?: string;
}

export class UpdateVariantDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: "SKU must contain only letters, numbers, hyphens, and underscores",
  })
  sku?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsEnum(VariantStatus)
  status?: VariantStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsString()
  licensePlanId?: string;
}

export class CreatePriceDto {
  @IsEnum(Currency)
  currency!: Currency;

  @IsInt()
  @Min(0, { message: "Price amount must be a non-negative integer" })
  amount!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  compareAtAmount?: number;

  @IsOptional()
  @IsEnum(BillingType)
  billingType?: BillingType;

  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePriceDto {
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @IsOptional()
  @IsInt()
  @Min(0, { message: "Price amount must be a non-negative integer" })
  amount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  compareAtAmount?: number;

  @IsOptional()
  @IsEnum(BillingType)
  billingType?: BillingType;

  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "Slug must be lowercase alphanumeric characters separated by single hyphens",
  })
  slug!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsEnum(CategoryStatus)
  status?: CategoryStatus;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "Slug must be lowercase alphanumeric characters separated by single hyphens",
  })
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsEnum(CategoryStatus)
  status?: CategoryStatus;
}

export class CatalogFilterQueryDto {
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

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(ProductType)
  productType?: ProductType;

  @IsOptional()
  @IsEnum(Currency, {
    message: `currency must be one of: ${Object.values(Currency).join(", ")}`,
  })
  currency?: Currency;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(["newest", "price_asc", "price_desc", "name_asc"])
  sort?: "newest" | "price_asc" | "price_desc" | "name_asc" = "newest";
}

export class AdminProductFilterQueryDto {
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

  @IsOptional()
  @IsEnum(ProductStatus, {
    message: `status must be one of: ${Object.values(ProductStatus).join(", ")}`,
  })
  status?: ProductStatus;

  @IsOptional()
  @IsEnum(ProductType, {
    message: `productType must be one of: ${Object.values(ProductType).join(", ")}`,
  })
  productType?: ProductType;

  @IsOptional()
  @IsString()
  search?: string;
}

