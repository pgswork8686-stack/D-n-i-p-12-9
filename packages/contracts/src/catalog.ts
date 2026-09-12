export type ProductType =
  | 'DOWNLOADABLE_ASSET'
  | 'LICENSED_SOFTWARE'
  | 'EXTERNAL_MANAGED_LICENSE'
  | 'MEMBERSHIP'
  | 'SUBSCRIPTION'
  | 'SERVICE';

export type FulfillmentType =
  | 'DIGITAL_DOWNLOAD'
  | 'INTERNAL_LICENSE'
  | 'EXTERNAL_MANAGED'
  | 'MEMBERSHIP_ACCESS'
  | 'MANUAL_SERVICE';

export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type VariantStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type CategoryStatus = 'ACTIVE' | 'ARCHIVED';
export type Currency = 'VND' | 'USD';
export type BillingType = 'ONE_TIME' | 'RECURRING';
export type BillingInterval = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export type MediaType = 'IMAGE' | 'GALLERY' | 'PREVIEW' | 'ICON' | 'THUMBNAIL';

// DTOs
export interface ProductPriceDto {
  id: string;
  variantId: string;
  currency: Currency;
  amount: number;
  compareAtAmount?: number | null;
  billingType: BillingType;
  billingInterval?: BillingInterval | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LicensePlanDto {
  id: string;
  name: string;
  maxActivations: number;
  durationDays?: number | null;
  durationMonths?: number | null;
  updatesDays?: number | null;
  supportDays?: number | null;
  isLifetime: boolean;
  metadata?: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductVariantDto {
  id: string;
  productId: string;
  sku: string;
  name: string;
  status: VariantStatus;
  sortOrder: number;
  metadata?: Record<string, any> | null;
  licensePlanId?: string | null;
  licensePlan?: LicensePlanDto | null;
  prices: ProductPriceDto[];
  createdAt: string;
  updatedAt: string;
}

export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  parentId?: string | null;
  sortOrder: number;
  status: CategoryStatus;
  createdAt: string;
  updatedAt: string;
  children?: CategoryDto[];
}

export interface ProductMediaDto {
  id: string;
  productId: string;
  type: MediaType;
  url: string;
  storageKey?: string | null;
  altText?: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductDto {
  id: string;
  slug: string;
  name: string;
  shortDescription?: string | null;
  description?: string | null;
  productType: ProductType;
  fulfillmentType: FulfillmentType;
  status: ProductStatus;
  brand?: string | null;
  metadata?: Record<string, any> | null;
  variants: ProductVariantDto[];
  categories: CategoryDto[];
  media: ProductMediaDto[];
  createdAt: string;
  updatedAt: string;
}

// Public API DTOs (Sanitized)
export interface PublicProductListItemDto {
  id: string;
  slug: string;
  name: string;
  shortDescription?: string | null;
  productType: ProductType;
  fulfillmentType: FulfillmentType;
  brand?: string | null;
  minPrice?: {
    currency: Currency;
    amount: number;
  } | null;
  minPricesByCurrency?: Partial<Record<Currency, number>>;
  thumbnailUrl?: string | null;
  categories: { id: string; name: string; slug: string }[];
}

export interface PublicProductDetailDto {
  id: string;
  slug: string;
  name: string;
  shortDescription?: string | null;
  description?: string | null;
  productType: ProductType;
  fulfillmentType: FulfillmentType;
  brand?: string | null;
  variants: {
    id: string;
    sku: string;
    name: string;
    sortOrder: number;
    licensePlan?: {
      name: string;
      maxActivations: number;
      isLifetime: boolean;
      durationDays?: number | null;
    } | null;
    prices: {
      id: string;
      currency: Currency;
      amount: number;
      compareAtAmount?: number | null;
      billingType: BillingType;
      billingInterval?: BillingInterval | null;
    }[];
  }[];
  categories: { id: string; name: string; slug: string }[];
  media: { id: string; type: MediaType; url: string; altText?: string | null }[];
}

// Requests / Payloads
export interface CreateProductRequest {
  slug: string;
  name: string;
  shortDescription?: string;
  description?: string;
  productType: ProductType;
  fulfillmentType: FulfillmentType;
  status?: ProductStatus;
  brand?: string;
  metadata?: Record<string, any>;
  categoryIds?: string[];
}

export interface UpdateProductRequest {
  slug?: string;
  name?: string;
  shortDescription?: string;
  description?: string;
  productType?: ProductType;
  fulfillmentType?: FulfillmentType;
  status?: ProductStatus;
  brand?: string;
  metadata?: Record<string, any>;
  categoryIds?: string[];
}

export interface CreateVariantRequest {
  sku: string;
  name: string;
  status?: VariantStatus;
  sortOrder?: number;
  metadata?: Record<string, any>;
  licensePlanId?: string;
}

export interface UpdateVariantRequest {
  sku?: string;
  name?: string;
  status?: VariantStatus;
  sortOrder?: number;
  metadata?: Record<string, any>;
  licensePlanId?: string;
}

export interface CreatePriceRequest {
  currency: Currency;
  amount: number;
  compareAtAmount?: number;
  billingType?: BillingType;
  billingInterval?: BillingInterval | null;
  isActive?: boolean;
}

export interface UpdatePriceRequest {
  currency?: Currency;
  amount?: number;
  compareAtAmount?: number;
  billingType?: BillingType;
  billingInterval?: BillingInterval | null;
  isActive?: boolean;
}

export interface CreateCategoryRequest {
  name: string;
  slug: string;
  description?: string;
  parentId?: string;
  sortOrder?: number;
  status?: CategoryStatus;
}

export interface UpdateCategoryRequest {
  name?: string;
  slug?: string;
  description?: string;
  parentId?: string;
  sortOrder?: number;
  status?: CategoryStatus;
}

export interface CreateLicensePlanRequest {
  name: string;
  maxActivations?: number;
  durationDays?: number;
  durationMonths?: number;
  updatesDays?: number;
  supportDays?: number;
  isLifetime?: boolean;
  metadata?: Record<string, any>;
}

export interface CatalogFilterQuery {
  page?: number;
  limit?: number;
  category?: string;
  productType?: ProductType;
  currency?: Currency;
  search?: string;
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'name_asc';
}

export interface AdminProductFilterQuery {
  page?: number;
  limit?: number;
  status?: ProductStatus;
  productType?: ProductType;
  search?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
