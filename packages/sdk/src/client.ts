import {
  HealthCheckResponse,
  AuthMeResponse,
  RoleDetail,
  PermissionDetail,
  AdminUserListItem,
  AuthUser,
  PublicProductListItemDto,
  PublicProductDetailDto,
  ProductDto,
  ProductVariantDto,
  ProductPriceDto,
  CategoryDto,
  CreateProductRequest,
  UpdateProductRequest,
  CreateVariantRequest,
  UpdateVariantRequest,
  CreatePriceRequest,
  UpdatePriceRequest,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  CatalogFilterQuery,
  PaginatedResponse,
} from "@nexus/contracts";

export interface NexusClientConfig {
  baseUrl: string;
  token?: string;
}

export class NexusApiClient {
  private baseUrl: string;
  private token?: string;

  constructor(config: NexusClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.token = config.token;
  }

  setToken(token?: string) {
    this.token = token;
  }

  async getHealth(): Promise<HealthCheckResponse> {
    const res = await fetch(`${this.baseUrl}/health`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Health check failed with status: ${res.status}`);
    }
    return (await res.json()) as HealthCheckResponse;
  }

  async getAuthMe(): Promise<AuthMeResponse> {
    const res = await fetch(`${this.baseUrl}/auth/me`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Auth me failed (${res.status}): ${errorText}`);
    }
    return (await res.json()) as AuthMeResponse;
  }

  async testRbac(level: "customer" | "admin" | "audit"): Promise<any> {
    const res = await fetch(`${this.baseUrl}/rbac/test/${level}`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`RBAC test ${level} failed (${res.status}): ${errorText}`);
    }
    return await res.json();
  }

  async listUsers(): Promise<{ status: string; count: number; users: AdminUserListItem[] }> {
    const res = await fetch(`${this.baseUrl}/admin/users`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`List users failed (${res.status})`);
    }
    return await res.json();
  }

  async listRoles(): Promise<{ status: string; count: number; roles: RoleDetail[] }> {
    const res = await fetch(`${this.baseUrl}/admin/roles`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`List roles failed (${res.status})`);
    }
    return await res.json();
  }

  async listPermissions(): Promise<{ status: string; count: number; permissions: PermissionDetail[] }> {
    const res = await fetch(`${this.baseUrl}/admin/permissions`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`List permissions failed (${res.status})`);
    }
    return await res.json();
  }

  async assignRole(userId: string, role: string): Promise<{ status: string; user: AuthUser }> {
    const res = await fetch(`${this.baseUrl}/admin/users/${userId}/roles`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Assign role failed (${res.status}): ${err}`);
    }
    return await res.json();
  }

  async removeRole(userId: string, role: string): Promise<{ status: string; user: AuthUser }> {
    const res = await fetch(`${this.baseUrl}/admin/users/${userId}/roles/${role}`, {
      method: "DELETE",
      headers: this.buildHeaders(),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Remove role failed (${res.status}): ${err}`);
    }
    return await res.json();
  }

  // ====================================================
  // PUBLIC CATALOG
  // ====================================================

  async listPublicProducts(
    params?: CatalogFilterQuery,
  ): Promise<PaginatedResponse<PublicProductListItemDto>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.category) searchParams.set("category", params.category);
    if (params?.productType) searchParams.set("productType", params.productType);
    if (params?.search) searchParams.set("search", params.search);
    if (params?.currency) searchParams.set("currency", params.currency);
    if (params?.sort) searchParams.set("sort", params.sort);

    const queryStr = searchParams.toString();
    const url = `${this.baseUrl}/products${queryStr ? `?${queryStr}` : ""}`;
    const res = await fetch(url, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`List public products failed with status: ${res.status}`);
    }
    return (await res.json()) as PaginatedResponse<PublicProductListItemDto>;
  }

  async getPublicProduct(slug: string): Promise<PublicProductDetailDto> {
    const res = await fetch(`${this.baseUrl}/products/${slug}`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Get public product '${slug}' failed with status: ${res.status}`);
    }
    return (await res.json()) as PublicProductDetailDto;
  }

  async listPublicCategories(): Promise<CategoryDto[]> {
    const res = await fetch(`${this.baseUrl}/categories`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`List public categories failed with status: ${res.status}`);
    }
    return (await res.json()) as CategoryDto[];
  }

  async getCategoryProducts(
    slug: string,
    params?: CatalogFilterQuery,
  ): Promise<PaginatedResponse<PublicProductListItemDto>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.productType) searchParams.set("productType", params.productType);
    if (params?.search) searchParams.set("search", params.search);
    if (params?.sort) searchParams.set("sort", params.sort);

    const queryStr = searchParams.toString();
    const url = `${this.baseUrl}/categories/${slug}/products${queryStr ? `?${queryStr}` : ""}`;
    const res = await fetch(url, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Get category products failed with status: ${res.status}`);
    }
    return (await res.json()) as PaginatedResponse<PublicProductListItemDto>;
  }

  // ====================================================
  // ADMIN CATALOG
  // ====================================================

  async adminListProducts(params?: any): Promise<PaginatedResponse<ProductDto>> {
    const searchParams = new URLSearchParams(params || {});
    const queryStr = searchParams.toString();
    const url = `${this.baseUrl}/admin/products${queryStr ? `?${queryStr}` : ""}`;
    const res = await fetch(url, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Admin list products failed with status: ${res.status}`);
    }
    return (await res.json()) as PaginatedResponse<ProductDto>;
  }

  async adminGetProduct(id: string): Promise<ProductDto> {
    const res = await fetch(`${this.baseUrl}/admin/products/${id}`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Admin get product '${id}' failed with status: ${res.status}`);
    }
    return (await res.json()) as ProductDto;
  }

  async adminCreateProduct(dto: CreateProductRequest): Promise<ProductDto> {
    const res = await fetch(`${this.baseUrl}/admin/products`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(dto),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Admin create product failed (${res.status}): ${err}`);
    }
    return (await res.json()) as ProductDto;
  }

  async adminUpdateProduct(id: string, dto: UpdateProductRequest): Promise<ProductDto> {
    const res = await fetch(`${this.baseUrl}/admin/products/${id}`, {
      method: "PATCH",
      headers: this.buildHeaders(),
      body: JSON.stringify(dto),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Admin update product failed (${res.status}): ${err}`);
    }
    return (await res.json()) as ProductDto;
  }

  async adminDeleteProduct(id: string): Promise<ProductDto> {
    const res = await fetch(`${this.baseUrl}/admin/products/${id}`, {
      method: "DELETE",
      headers: this.buildHeaders(),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Admin delete product failed (${res.status}): ${err}`);
    }
    return (await res.json()) as ProductDto;
  }

  async adminCreateVariant(productId: string, dto: CreateVariantRequest): Promise<ProductVariantDto> {
    const res = await fetch(`${this.baseUrl}/admin/products/${productId}/variants`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(dto),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Admin create variant failed (${res.status}): ${err}`);
    }
    return (await res.json()) as ProductVariantDto;
  }

  async adminUpdateVariant(
    productId: string,
    variantId: string,
    dto: UpdateVariantRequest,
  ): Promise<ProductVariantDto> {
    const res = await fetch(`${this.baseUrl}/admin/products/${productId}/variants/${variantId}`, {
      method: "PATCH",
      headers: this.buildHeaders(),
      body: JSON.stringify(dto),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Admin update variant failed (${res.status}): ${err}`);
    }
    return (await res.json()) as ProductVariantDto;
  }

  async adminDeleteVariant(productId: string, variantId: string): Promise<ProductVariantDto> {
    const res = await fetch(`${this.baseUrl}/admin/products/${productId}/variants/${variantId}`, {
      method: "DELETE",
      headers: this.buildHeaders(),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Admin delete variant failed (${res.status}): ${err}`);
    }
    return (await res.json()) as ProductVariantDto;
  }

  async adminCreatePrice(variantId: string, dto: CreatePriceRequest): Promise<ProductPriceDto> {
    const res = await fetch(`${this.baseUrl}/admin/variants/${variantId}/prices`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(dto),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Admin create price failed (${res.status}): ${err}`);
    }
    return (await res.json()) as ProductPriceDto;
  }

  async adminUpdatePrice(priceId: string, dto: UpdatePriceRequest): Promise<ProductPriceDto> {
    const res = await fetch(`${this.baseUrl}/admin/prices/${priceId}`, {
      method: "PATCH",
      headers: this.buildHeaders(),
      body: JSON.stringify(dto),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Admin update price failed (${res.status}): ${err}`);
    }
    return (await res.json()) as ProductPriceDto;
  }

  async adminCreateCategory(dto: CreateCategoryRequest): Promise<CategoryDto> {
    const res = await fetch(`${this.baseUrl}/admin/categories`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(dto),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Admin create category failed (${res.status}): ${err}`);
    }
    return (await res.json()) as CategoryDto;
  }

  async adminListCategories(): Promise<CategoryDto[]> {
    const res = await fetch(`${this.baseUrl}/admin/categories`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Admin list categories failed with status: ${res.status}`);
    }
    return (await res.json()) as CategoryDto[];
  }

  async adminGetCategory(id: string): Promise<CategoryDto> {
    const res = await fetch(`${this.baseUrl}/admin/categories/${id}`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Admin get category '${id}' failed with status: ${res.status}`);
    }
    return (await res.json()) as CategoryDto;
  }

  async adminUpdateCategory(id: string, dto: UpdateCategoryRequest): Promise<CategoryDto> {
    const res = await fetch(`${this.baseUrl}/admin/categories/${id}`, {
      method: "PATCH",
      headers: this.buildHeaders(),
      body: JSON.stringify(dto),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Admin update category failed (${res.status}): ${err}`);
    }
    return (await res.json()) as CategoryDto;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    return headers;
  }
}


