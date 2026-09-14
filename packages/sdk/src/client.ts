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
  CartDto,
  AddToCartRequest,
  UpdateCartItemRequest,
  CheckoutRequest,
  CheckoutResponse,
  OrderDto,
  TestPaymentCallbackRequest,
  TestPaymentCallbackResponse,
  OrderFilterQuery,
  Currency,
  EntitlementDto,
  EntitlementFilterQuery,
  AdminEntitlementFilterQuery,
  RevokeEntitlementRequest,
  LicenseAllocationDto,
  CustomerAllocationDto,
  LicenseProviderDto,
  ProviderAccountDto,
  RequestAllocationRequest,
  AdminActivateAllocationRequest,
  AdminRejectAllocationRequest,
  RequestDeactivationRequest,
  AdminConfirmDeactivatedRequest,
  CreateProviderAccountRequest,
  UpdateProviderAccountRequest,
  AdminAllocationFilterQuery,
  ProductVersionDto,
  ProductVersionFileDto,
  CreateProductVersionRequest,
  PublishVersionResponse,
  RequestDownloadRequest,
  DownloadUrlResponse,
  CheckUpdateRequest,
  CheckUpdateResponse,
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
      throw new Error(
        `RBAC test ${level} failed (${res.status}): ${errorText}`,
      );
    }
    return await res.json();
  }

  async listUsers(): Promise<{
    status: string;
    count: number;
    users: AdminUserListItem[];
  }> {
    const res = await fetch(`${this.baseUrl}/admin/users`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`List users failed (${res.status})`);
    }
    return await res.json();
  }

  async listRoles(): Promise<{
    status: string;
    count: number;
    roles: RoleDetail[];
  }> {
    const res = await fetch(`${this.baseUrl}/admin/roles`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`List roles failed (${res.status})`);
    }
    return await res.json();
  }

  async listPermissions(): Promise<{
    status: string;
    count: number;
    permissions: PermissionDetail[];
  }> {
    const res = await fetch(`${this.baseUrl}/admin/permissions`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`List permissions failed (${res.status})`);
    }
    return await res.json();
  }

  async assignRole(
    userId: string,
    role: string,
  ): Promise<{ status: string; user: AuthUser }> {
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

  async removeRole(
    userId: string,
    role: string,
  ): Promise<{ status: string; user: AuthUser }> {
    const res = await fetch(
      `${this.baseUrl}/admin/users/${userId}/roles/${role}`,
      {
        method: "DELETE",
        headers: this.buildHeaders(),
      },
    );
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
    if (params?.productType)
      searchParams.set("productType", params.productType);
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
      throw new Error(
        `Get public product '${slug}' failed with status: ${res.status}`,
      );
    }
    return (await res.json()) as PublicProductDetailDto;
  }

  async listPublicCategories(): Promise<CategoryDto[]> {
    const res = await fetch(`${this.baseUrl}/categories`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(
        `List public categories failed with status: ${res.status}`,
      );
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
    if (params?.productType)
      searchParams.set("productType", params.productType);
    if (params?.search) searchParams.set("search", params.search);
    if (params?.currency) searchParams.set("currency", params.currency);
    if (params?.sort) searchParams.set("sort", params.sort);

    const queryStr = searchParams.toString();
    const url = `${this.baseUrl}/categories/${slug}/products${queryStr ? `?${queryStr}` : ""}`;
    const res = await fetch(url, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(
        `Get category products failed with status: ${res.status}`,
      );
    }
    return (await res.json()) as PaginatedResponse<PublicProductListItemDto>;
  }

  // ====================================================
  // ADMIN CATALOG
  // ====================================================

  async adminListProducts(
    params?: any,
  ): Promise<PaginatedResponse<ProductDto>> {
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
      throw new Error(
        `Admin get product '${id}' failed with status: ${res.status}`,
      );
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

  async adminUpdateProduct(
    id: string,
    dto: UpdateProductRequest,
  ): Promise<ProductDto> {
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

  async adminCreateVariant(
    productId: string,
    dto: CreateVariantRequest,
  ): Promise<ProductVariantDto> {
    const res = await fetch(
      `${this.baseUrl}/admin/products/${productId}/variants`,
      {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(dto),
      },
    );
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
    const res = await fetch(
      `${this.baseUrl}/admin/products/${productId}/variants/${variantId}`,
      {
        method: "PATCH",
        headers: this.buildHeaders(),
        body: JSON.stringify(dto),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Admin update variant failed (${res.status}): ${err}`);
    }
    return (await res.json()) as ProductVariantDto;
  }

  async adminDeleteVariant(
    productId: string,
    variantId: string,
  ): Promise<ProductVariantDto> {
    const res = await fetch(
      `${this.baseUrl}/admin/products/${productId}/variants/${variantId}`,
      {
        method: "DELETE",
        headers: this.buildHeaders(),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Admin delete variant failed (${res.status}): ${err}`);
    }
    return (await res.json()) as ProductVariantDto;
  }

  async adminCreatePrice(
    variantId: string,
    dto: CreatePriceRequest,
  ): Promise<ProductPriceDto> {
    const res = await fetch(
      `${this.baseUrl}/admin/variants/${variantId}/prices`,
      {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(dto),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Admin create price failed (${res.status}): ${err}`);
    }
    return (await res.json()) as ProductPriceDto;
  }

  async adminUpdatePrice(
    priceId: string,
    dto: UpdatePriceRequest,
  ): Promise<ProductPriceDto> {
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
      throw new Error(
        `Admin list categories failed with status: ${res.status}`,
      );
    }
    return (await res.json()) as CategoryDto[];
  }

  async adminGetCategory(id: string): Promise<CategoryDto> {
    const res = await fetch(`${this.baseUrl}/admin/categories/${id}`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(
        `Admin get category '${id}' failed with status: ${res.status}`,
      );
    }
    return (await res.json()) as CategoryDto;
  }

  async adminUpdateCategory(
    id: string,
    dto: UpdateCategoryRequest,
  ): Promise<CategoryDto> {
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

  // --------------------------------------------------------
  // Commerce & Cart Methods
  // --------------------------------------------------------

  async getCart(currency?: Currency): Promise<CartDto> {
    const url = new URL(`${this.baseUrl}/cart`);
    if (currency) {
      url.searchParams.set("currency", currency);
    }
    const res = await fetch(url.toString(), {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Get cart failed (${res.status}): ${err}`);
    }
    return (await res.json()) as CartDto;
  }

  async addToCart(dto: AddToCartRequest): Promise<CartDto> {
    const res = await fetch(`${this.baseUrl}/cart/items`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(dto),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Add to cart failed (${res.status}): ${err}`);
    }
    return (await res.json()) as CartDto;
  }

  async updateCartItem(
    itemId: string,
    dto: UpdateCartItemRequest,
  ): Promise<CartDto> {
    const res = await fetch(`${this.baseUrl}/cart/items/${itemId}`, {
      method: "PATCH",
      headers: this.buildHeaders(),
      body: JSON.stringify(dto),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Update cart item failed (${res.status}): ${err}`);
    }
    return (await res.json()) as CartDto;
  }

  async removeCartItem(itemId: string): Promise<CartDto> {
    const res = await fetch(`${this.baseUrl}/cart/items/${itemId}`, {
      method: "DELETE",
      headers: this.buildHeaders(),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Remove cart item failed (${res.status}): ${err}`);
    }
    return (await res.json()) as CartDto;
  }

  async clearCart(): Promise<{ success: boolean }> {
    const res = await fetch(`${this.baseUrl}/cart`, {
      method: "DELETE",
      headers: this.buildHeaders(),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Clear cart failed (${res.status}): ${err}`);
    }
    return (await res.json()) as { success: boolean };
  }

  async checkout(dto: CheckoutRequest): Promise<CheckoutResponse> {
    const res = await fetch(`${this.baseUrl}/checkout`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(dto),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Checkout failed (${res.status}): ${err}`);
    }
    return (await res.json()) as CheckoutResponse;
  }

  async listOrders(
    query?: OrderFilterQuery,
  ): Promise<PaginatedResponse<OrderDto>> {
    const url = new URL(`${this.baseUrl}/orders`);
    if (query?.page) url.searchParams.set("page", String(query.page));
    if (query?.limit) url.searchParams.set("limit", String(query.limit));
    if (query?.status) url.searchParams.set("status", query.status);

    const res = await fetch(url.toString(), {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`List orders failed (${res.status}): ${err}`);
    }
    return (await res.json()) as PaginatedResponse<OrderDto>;
  }

  async getOrder(id: string): Promise<OrderDto> {
    const res = await fetch(`${this.baseUrl}/orders/${id}`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Get order failed (${res.status}): ${err}`);
    }
    return (await res.json()) as OrderDto;
  }

  async listAdminOrders(
    query?: OrderFilterQuery,
  ): Promise<PaginatedResponse<OrderDto>> {
    const url = new URL(`${this.baseUrl}/admin/orders`);
    if (query?.page) url.searchParams.set("page", String(query.page));
    if (query?.limit) url.searchParams.set("limit", String(query.limit));
    if (query?.status) url.searchParams.set("status", query.status);
    if (query?.userId) url.searchParams.set("userId", query.userId);

    const res = await fetch(url.toString(), {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`List admin orders failed (${res.status}): ${err}`);
    }
    return (await res.json()) as PaginatedResponse<OrderDto>;
  }

  async getAdminOrder(id: string): Promise<OrderDto> {
    const res = await fetch(`${this.baseUrl}/admin/orders/${id}`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Get admin order failed (${res.status}): ${err}`);
    }
    return (await res.json()) as OrderDto;
  }

  async simulateTestPayment(
    dto: TestPaymentCallbackRequest,
    signature?: string,
  ): Promise<TestPaymentCallbackResponse> {
    const headers = this.buildHeaders();
    if (signature) {
      headers["x-test-signature"] = signature;
    }
    const res = await fetch(`${this.baseUrl}/payments/test-callback`, {
      method: "POST",
      headers,
      body: JSON.stringify(dto),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Simulate test payment failed (${res.status}): ${err}`);
    }
    return (await res.json()) as TestPaymentCallbackResponse;
  }

  async listEntitlements(
    query?: EntitlementFilterQuery,
  ): Promise<PaginatedResponse<EntitlementDto>> {
    const url = new URL(`${this.baseUrl}/entitlements`);
    if (query?.page) url.searchParams.set("page", String(query.page));
    if (query?.limit) url.searchParams.set("limit", String(query.limit));
    if (query?.status) url.searchParams.set("status", query.status);
    if (query?.productId) url.searchParams.set("productId", query.productId);
    if (query?.fulfillmentType)
      url.searchParams.set("fulfillmentType", query.fulfillmentType);

    const res = await fetch(url.toString(), {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`List entitlements failed (${res.status}): ${err}`);
    }
    return (await res.json()) as PaginatedResponse<EntitlementDto>;
  }

  async getEntitlement(id: string): Promise<EntitlementDto> {
    const res = await fetch(`${this.baseUrl}/entitlements/${id}`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Get entitlement failed (${res.status}): ${err}`);
    }
    return (await res.json()) as EntitlementDto;
  }

  async listAdminEntitlements(
    query?: AdminEntitlementFilterQuery,
  ): Promise<PaginatedResponse<EntitlementDto>> {
    const url = new URL(`${this.baseUrl}/admin/entitlements`);
    if (query?.page) url.searchParams.set("page", String(query.page));
    if (query?.limit) url.searchParams.set("limit", String(query.limit));
    if (query?.status) url.searchParams.set("status", query.status);
    if (query?.userId) url.searchParams.set("userId", query.userId);
    if (query?.orderId) url.searchParams.set("orderId", query.orderId);
    if (query?.productId) url.searchParams.set("productId", query.productId);
    if (query?.fulfillmentType)
      url.searchParams.set("fulfillmentType", query.fulfillmentType);

    const res = await fetch(url.toString(), {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`List admin entitlements failed (${res.status}): ${err}`);
    }
    return (await res.json()) as PaginatedResponse<EntitlementDto>;
  }

  async getAdminEntitlement(id: string): Promise<EntitlementDto> {
    const res = await fetch(`${this.baseUrl}/admin/entitlements/${id}`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Get admin entitlement failed (${res.status}): ${err}`);
    }
    return (await res.json()) as EntitlementDto;
  }

  async adminRevokeEntitlement(
    id: string,
    reason?: string,
  ): Promise<EntitlementDto> {
    const res = await fetch(`${this.baseUrl}/admin/entitlements/${id}/revoke`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Admin revoke entitlement failed (${res.status}): ${err}`);
    }
    return (await res.json()) as EntitlementDto;
  }

  // ---------------------------------------------------------------------------
  // Phase 6 — External Managed License Allocations
  // ---------------------------------------------------------------------------

  async requestAllocation(
    entitlementId: string,
    domain: string,
  ): Promise<CustomerAllocationDto> {
    const res = await fetch(
      `${this.baseUrl}/entitlements/${entitlementId}/allocations`,
      {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({ domain }),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Request allocation failed (${res.status}): ${err}`);
    }
    return (await res.json()) as CustomerAllocationDto;
  }

  async listAllocations(
    entitlementId: string,
  ): Promise<CustomerAllocationDto[]> {
    const res = await fetch(
      `${this.baseUrl}/entitlements/${entitlementId}/allocations`,
      {
        headers: this.buildHeaders(),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`List allocations failed (${res.status}): ${err}`);
    }
    return (await res.json()) as CustomerAllocationDto[];
  }

  async requestDeactivation(
    entitlementId: string,
    allocationId: string,
    reason?: string,
  ): Promise<CustomerAllocationDto> {
    const res = await fetch(
      `${this.baseUrl}/entitlements/${entitlementId}/allocations/${allocationId}/request-deactivation`,
      {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({ reason }),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Request deactivation failed (${res.status}): ${err}`);
    }
    return (await res.json()) as CustomerAllocationDto;
  }

  async adminListProviders(): Promise<LicenseProviderDto[]> {
    const res = await fetch(`${this.baseUrl}/admin/license-providers`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`List providers failed (${res.status}): ${err}`);
    }
    return (await res.json()) as LicenseProviderDto[];
  }

  async adminListProviderAccounts(
    providerId?: string,
  ): Promise<ProviderAccountDto[]> {
    const url = new URL(`${this.baseUrl}/admin/provider-accounts`);
    if (providerId) {
      url.searchParams.set("providerId", providerId);
    }
    const res = await fetch(url.toString(), {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`List provider accounts failed (${res.status}): ${err}`);
    }
    return (await res.json()) as ProviderAccountDto[];
  }

  async adminCreateProviderAccount(
    req: CreateProviderAccountRequest,
  ): Promise<ProviderAccountDto> {
    const res = await fetch(`${this.baseUrl}/admin/provider-accounts`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Create provider account failed (${res.status}): ${err}`);
    }
    return (await res.json()) as ProviderAccountDto;
  }

  async adminGetProviderAccount(id: string): Promise<ProviderAccountDto> {
    const res = await fetch(`${this.baseUrl}/admin/provider-accounts/${id}`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Get provider account failed (${res.status}): ${err}`);
    }
    return (await res.json()) as ProviderAccountDto;
  }

  async adminUpdateProviderAccount(
    id: string,
    req: UpdateProviderAccountRequest,
  ): Promise<ProviderAccountDto> {
    const res = await fetch(`${this.baseUrl}/admin/provider-accounts/${id}`, {
      method: "PATCH",
      headers: this.buildHeaders(),
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Update provider account failed (${res.status}): ${err}`);
    }
    return (await res.json()) as ProviderAccountDto;
  }

  async adminListAllocations(
    query?: AdminAllocationFilterQuery,
  ): Promise<PaginatedResponse<LicenseAllocationDto>> {
    const url = new URL(`${this.baseUrl}/admin/license-allocations`);
    if (query) {
      Object.entries(query).forEach(([key, val]) => {
        if (val !== undefined && val !== null) {
          url.searchParams.set(key, String(val));
        }
      });
    }
    const res = await fetch(url.toString(), {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Admin list allocations failed (${res.status}): ${err}`);
    }
    return (await res.json()) as PaginatedResponse<LicenseAllocationDto>;
  }

  async adminGetAllocation(id: string): Promise<LicenseAllocationDto> {
    const res = await fetch(`${this.baseUrl}/admin/license-allocations/${id}`, {
      headers: this.buildHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Admin get allocation failed (${res.status}): ${err}`);
    }
    return (await res.json()) as LicenseAllocationDto;
  }

  async adminActivateAllocation(
    id: string,
    providerAccountId: string,
    notes?: string,
  ): Promise<LicenseAllocationDto> {
    const res = await fetch(
      `${this.baseUrl}/admin/license-allocations/${id}/activate`,
      {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({ providerAccountId, notes }),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Admin activate allocation failed (${res.status}): ${err}`);
    }
    return (await res.json()) as LicenseAllocationDto;
  }

  async adminRejectAllocation(
    id: string,
    reason: string,
  ): Promise<LicenseAllocationDto> {
    const res = await fetch(
      `${this.baseUrl}/admin/license-allocations/${id}/reject`,
      {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({ reason }),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Admin reject allocation failed (${res.status}): ${err}`);
    }
    return (await res.json()) as LicenseAllocationDto;
  }

  async adminRequestDeactivation(
    id: string,
    reason?: string,
  ): Promise<LicenseAllocationDto> {
    const res = await fetch(
      `${this.baseUrl}/admin/license-allocations/${id}/request-deactivation`,
      {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({ reason }),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(
        `Admin request deactivation failed (${res.status}): ${err}`,
      );
    }
    return (await res.json()) as LicenseAllocationDto;
  }

  async adminConfirmDeactivated(
    id: string,
    notes?: string,
  ): Promise<LicenseAllocationDto> {
    const res = await fetch(
      `${this.baseUrl}/admin/license-allocations/${id}/confirm-deactivated`,
      {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({ notes }),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(
        `Admin confirm deactivated failed (${res.status}): ${err}`,
      );
    }
    return (await res.json()) as LicenseAllocationDto;
  }

  // ----------------------------------------------------
  // Product Versions (Admin)
  // ----------------------------------------------------

  async createProductVersion(
    productId: string,
    data: CreateProductVersionRequest,
  ): Promise<ProductVersionDto> {
    const res = await fetch(`${this.baseUrl}/admin/products/${productId}/versions`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Create product version failed (${res.status}): ${err}`);
    }
    return (await res.json()) as ProductVersionDto;
  }

  async listProductVersions(productId: string): Promise<ProductVersionDto[]> {
    const res = await fetch(`${this.baseUrl}/admin/products/${productId}/versions`, {
      method: "GET",
      headers: this.buildHeaders(),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`List product versions failed (${res.status}): ${err}`);
    }
    return (await res.json()) as ProductVersionDto[];
  }

  async getProductVersion(versionId: string): Promise<ProductVersionDto> {
    const res = await fetch(`${this.baseUrl}/admin/product-versions/${versionId}`, {
      method: "GET",
      headers: this.buildHeaders(),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Get product version failed (${res.status}): ${err}`);
    }
    return (await res.json()) as ProductVersionDto;
  }

  async uploadVersionFile(
    versionId: string,
    fileBuffer: Buffer | Uint8Array,
    fileName: string,
    isPrimary?: boolean,
    contentType = "application/zip",
  ): Promise<ProductVersionFileDto> {
    const formData = new FormData();
    const blob = new Blob([fileBuffer as any], { type: contentType });
    formData.append("file", blob, fileName);
    if (isPrimary !== undefined) {
      formData.append("isPrimary", String(isPrimary));
    }

    const headers = this.buildHeaders();
    delete headers["Content-Type"];

    const res = await fetch(`${this.baseUrl}/admin/product-versions/${versionId}/files/upload`, {
      method: "POST",
      headers,
      body: formData,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Upload version file failed (${res.status}): ${err}`);
    }
    return (await res.json()) as ProductVersionFileDto;
  }

  async publishProductVersion(versionId: string): Promise<PublishVersionResponse> {
    const res = await fetch(`${this.baseUrl}/admin/product-versions/${versionId}/publish`, {
      method: "POST",
      headers: this.buildHeaders(),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Publish product version failed (${res.status}): ${err}`);
    }
    return (await res.json()) as PublishVersionResponse;
  }

  // ----------------------------------------------------
  // Customer Downloads
  // ----------------------------------------------------

  async requestDownload(data: RequestDownloadRequest): Promise<DownloadUrlResponse> {
    const res = await fetch(`${this.baseUrl}/v1/downloads/request`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Request download failed (${res.status}): ${err}`);
    }
    return (await res.json()) as DownloadUrlResponse;
  }

  // ----------------------------------------------------
  // License Updater Check
  // ----------------------------------------------------

  async checkUpdate(data: CheckUpdateRequest): Promise<CheckUpdateResponse> {
    const res = await fetch(`${this.baseUrl}/v1/updates/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Check update failed (${res.status}): ${err}`);
    }
    return (await res.json()) as CheckUpdateResponse;
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
