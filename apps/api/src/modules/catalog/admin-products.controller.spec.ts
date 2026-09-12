import { Test, TestingModule } from "@nestjs/testing";
import { AdminProductsController } from "./admin-products.controller";
import { ProductsService } from "./products.service";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { ProductType, FulfillmentType, ProductStatus } from "@nexus/database";

describe("AdminProductsController", () => {
  let controller: AdminProductsController;
  let productsService: jest.Mocked<ProductsService>;

  beforeEach(async () => {
    const mockProductsService = {
      createProduct: jest.fn().mockResolvedValue({ id: "p1", name: "Test Product" }),
      listAdminProducts: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getProductById: jest.fn().mockResolvedValue({ id: "p1", name: "Test Product" }),
      updateProduct: jest.fn().mockResolvedValue({ id: "p1", name: "Updated Product" }),
      deleteProduct: jest.fn().mockResolvedValue({ id: "p1", status: ProductStatus.ARCHIVED }),
      createVariant: jest.fn().mockResolvedValue({ id: "v1", sku: "SKU1" }),
      updateVariant: jest.fn().mockResolvedValue({ id: "v1", sku: "SKU1_UPDATED" }),
      deleteVariant: jest.fn().mockResolvedValue({ id: "v1", status: "ARCHIVED" }),
      createPrice: jest.fn().mockResolvedValue({ id: "pr1", amount: 1000 }),
      updatePrice: jest.fn().mockResolvedValue({ id: "pr1", amount: 2000 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminProductsController],
      providers: [{ provide: ProductsService, useValue: mockProductsService }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AdminProductsController>(AdminProductsController);
    productsService = module.get(ProductsService);
  });

  it("delegates createProduct to ProductsService with actorId and permissions", async () => {
    const dto: any = {
      slug: "test-prod",
      name: "Test Prod",
      productType: ProductType.DOWNLOADABLE_ASSET,
      fulfillmentType: FulfillmentType.DIGITAL_DOWNLOAD,
    };
    const req: any = { user: { id: "admin_1", permissions: ["product.write"] } };

    const result = await controller.createProduct(dto, req);

    expect(result.id).toBe("p1");
    expect(productsService.createProduct).toHaveBeenCalledWith(
      dto,
      "admin_1",
      ["product.write"],
    );
  });

  it("delegates updateProduct to ProductsService", async () => {
    const dto: any = { name: "Updated" };
    const req: any = { user: { id: "admin_1", permissions: ["product.write"] } };

    const result = await controller.updateProduct("p1", dto, req);

    expect(result.id).toBe("p1");
    expect(productsService.updateProduct).toHaveBeenCalledWith(
      "p1",
      dto,
      "admin_1",
      ["product.write"],
    );
  });

  it("delegates createVariant to ProductsService", async () => {
    const dto: any = { sku: "SKU1", name: "Var 1" };
    const req: any = { user: { id: "admin_1" } };

    const result = await controller.createVariant("p1", dto, req);

    expect(result.id).toBe("v1");
    expect(productsService.createVariant).toHaveBeenCalledWith("p1", dto, "admin_1");
  });

  it("delegates createPrice to ProductsService", async () => {
    const dto: any = { currency: "VND", amount: 1000 };
    const req: any = { user: { id: "admin_1" } };

    const result = await controller.createPrice("v1", dto, req);

    expect(result.id).toBe("pr1");
    expect(productsService.createPrice).toHaveBeenCalledWith("v1", dto, "admin_1");
  });

  it("delegates listProducts with AdminProductFilterQueryDto", async () => {
    const query = { page: 1, limit: 20, status: ProductStatus.ACTIVE };
    await controller.listProducts(query);
    expect(productsService.listAdminProducts).toHaveBeenCalledWith(query);
  });
});
