import { Test, TestingModule } from "@nestjs/testing";
import {
  PublicProductsController,
  PublicCategoriesController,
} from "./public-catalog.controller";
import { ProductsService } from "./products.service";
import { CategoriesService } from "./categories.service";

describe("PublicCatalogControllers", () => {
  let productsController: PublicProductsController;
  let categoriesController: PublicCategoriesController;
  let productsService: jest.Mocked<ProductsService>;
  let categoriesService: jest.Mocked<CategoriesService>;

  beforeEach(async () => {
    const mockProductsService = {
      listPublicProducts: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      getPublicProductBySlug: jest.fn().mockResolvedValue({ id: "p1", slug: "elementor-pro" }),
    };

    const mockCategoriesService = {
      listCategories: jest.fn().mockResolvedValue([{ id: "c1", slug: "wordpress" }]),
      getCategoryBySlug: jest.fn().mockResolvedValue({ id: "c1", slug: "wordpress" }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicProductsController, PublicCategoriesController],
      providers: [
        { provide: ProductsService, useValue: mockProductsService },
        { provide: CategoriesService, useValue: mockCategoriesService },
      ],
    }).compile();

    productsController = module.get<PublicProductsController>(PublicProductsController);
    categoriesController = module.get<PublicCategoriesController>(PublicCategoriesController);
    productsService = module.get(ProductsService);
    categoriesService = module.get(CategoriesService);
  });

  describe("PublicProductsController", () => {
    it("listProducts delegates query to ProductsService.listPublicProducts", async () => {
      const query = { page: 1, limit: 10, search: "elementor" };
      await productsController.listProducts(query);
      expect(productsService.listPublicProducts).toHaveBeenCalledWith(query);
    });

    it("getProductBySlug delegates to ProductsService.getPublicProductBySlug", async () => {
      const result = await productsController.getProductBySlug("elementor-pro");
      expect(result.slug).toBe("elementor-pro");
      expect(productsService.getPublicProductBySlug).toHaveBeenCalledWith("elementor-pro");
    });
  });

  describe("PublicCategoriesController", () => {
    it("listCategories delegates to CategoriesService.listCategories without archived", async () => {
      const result = await categoriesController.listCategories();
      expect(result.length).toBe(1);
      expect(categoriesService.listCategories).toHaveBeenCalledWith(false);
    });

    it("getCategoryProducts checks category exists and filters products", async () => {
      await categoriesController.getCategoryProducts("wordpress", { page: 1 });
      expect(categoriesService.getCategoryBySlug).toHaveBeenCalledWith("wordpress");
      expect(productsService.listPublicProducts).toHaveBeenCalledWith(
        expect.objectContaining({ category: "wordpress" }),
      );
    });
  });
});
