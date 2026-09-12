import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RequirePermissions } from "../auth/require-permissions.decorator";
import { ProductsService } from "./products.service";
import {
  CreateProductDto,
  UpdateProductDto,
  CreateVariantDto,
  UpdateVariantDto,
  CreatePriceDto,
  UpdatePriceDto,
  AdminProductFilterQueryDto,
} from "./dto/catalog.dto";

@Controller("admin")
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // ----------------------------------------------------
  // PRODUCTS
  // ----------------------------------------------------

  @Post("products")
  @RequirePermissions("product.write")
  async createProduct(@Body() dto: CreateProductDto, @Req() req: any): Promise<any> {
    const actorId = req.user.id;
    const permissions = req.user.permissions || [];
    return this.productsService.createProduct(dto, actorId, permissions);
  }

  @Get("products")
  @RequirePermissions("product.read")
  async listProducts(@Query() query: AdminProductFilterQueryDto): Promise<any> {
    return this.productsService.listAdminProducts(query);
  }

  @Get("products/:id")
  @RequirePermissions("product.read")
  async getProduct(@Param("id") id: string): Promise<any> {
    return this.productsService.getProductById(id);
  }

  @Patch("products/:id")
  @RequirePermissions("product.write")
  async updateProduct(
    @Param("id") id: string,
    @Body() dto: UpdateProductDto,
    @Req() req: any,
  ): Promise<any> {
    const actorId = req.user.id;
    const permissions = req.user.permissions || [];
    return this.productsService.updateProduct(id, dto, actorId, permissions);
  }

  @Delete("products/:id")
  @RequirePermissions("product.write")
  async deleteProduct(@Param("id") id: string, @Req() req: any): Promise<any> {
    const actorId = req.user.id;
    return this.productsService.deleteProduct(id, actorId);
  }

  // ----------------------------------------------------
  // VARIANTS
  // ----------------------------------------------------

  @Post("products/:id/variants")
  @RequirePermissions("product.write")
  async createVariant(
    @Param("id") productId: string,
    @Body() dto: CreateVariantDto,
    @Req() req: any,
  ): Promise<any> {
    const actorId = req.user.id;
    return this.productsService.createVariant(productId, dto, actorId);
  }

  @Patch("products/:id/variants/:variantId")
  @RequirePermissions("product.write")
  async updateVariant(
    @Param("id") productId: string,
    @Param("variantId") variantId: string,
    @Body() dto: UpdateVariantDto,
    @Req() req: any,
  ): Promise<any> {
    const actorId = req.user.id;
    return this.productsService.updateVariant(productId, variantId, dto, actorId);
  }

  @Delete("products/:id/variants/:variantId")
  @RequirePermissions("product.write")
  async deleteVariant(
    @Param("id") productId: string,
    @Param("variantId") variantId: string,
    @Req() req: any,
  ): Promise<any> {
    const actorId = req.user.id;
    return this.productsService.deleteVariant(productId, variantId, actorId);
  }

  // ----------------------------------------------------
  // PRICES
  // ----------------------------------------------------

  @Post("variants/:variantId/prices")
  @RequirePermissions("product.write")
  async createPrice(
    @Param("variantId") variantId: string,
    @Body() dto: CreatePriceDto,
    @Req() req: any,
  ): Promise<any> {
    const actorId = req.user.id;
    return this.productsService.createPrice(variantId, dto, actorId);
  }

  @Patch("prices/:priceId")
  @RequirePermissions("product.write")
  async updatePrice(
    @Param("priceId") priceId: string,
    @Body() dto: UpdatePriceDto,
    @Req() req: any,
  ): Promise<any> {
    const actorId = req.user.id;
    return this.productsService.updatePrice(priceId, dto, actorId);
  }
}
