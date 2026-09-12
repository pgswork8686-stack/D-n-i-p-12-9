import { Controller, Get, Param, Query } from "@nestjs/common";
import { ProductsService } from "./products.service";
import { CategoriesService } from "./categories.service";
import { CatalogFilterQueryDto } from "./dto/catalog.dto";

@Controller("products")
export class PublicProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async listProducts(@Query() query: CatalogFilterQueryDto) {
    return this.productsService.listPublicProducts(query);
  }

  @Get(":slug")
  async getProductBySlug(@Param("slug") slug: string) {
    return this.productsService.getPublicProductBySlug(slug);
  }
}

@Controller("categories")
export class PublicCategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly productsService: ProductsService,
  ) {}

  @Get()
  async listCategories() {
    return this.categoriesService.listCategories(false);
  }

  @Get(":slug/products")
  async getCategoryProducts(
    @Param("slug") slug: string,
    @Query() query: CatalogFilterQueryDto,
  ) {
    // Verify category exists and is active
    await this.categoriesService.getCategoryBySlug(slug);
    return this.productsService.listPublicProducts({
      ...query,
      category: slug,
    });
  }
}
