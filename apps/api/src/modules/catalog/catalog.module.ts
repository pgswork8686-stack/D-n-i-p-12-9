import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { ProductsService } from "./products.service";
import { CategoriesService } from "./categories.service";
import { AdminProductsController } from "./admin-products.controller";
import { AdminCategoriesController } from "./admin-categories.controller";
import {
  PublicProductsController,
  PublicCategoriesController,
} from "./public-catalog.controller";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [
    AdminProductsController,
    AdminCategoriesController,
    PublicProductsController,
    PublicCategoriesController,
  ],
  providers: [ProductsService, CategoriesService],
  exports: [ProductsService, CategoriesService],
})
export class CatalogModule {}
