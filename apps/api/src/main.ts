import { NestFactory } from "@nestjs/core";
import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { resolveCorsOrigins } from "@nexus/utils";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter";

async function bootstrap() {
  const logger = new Logger("Bootstrap");
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const configService = app.get(ConfigService);
  const allowedOrigins = resolveCorsOrigins({
    webUrl: configService.get<string>("WEB_URL"),
    portalUrl: configService.get<string>("PORTAL_URL"),
    adminUrl: configService.get<string>("ADMIN_URL"),
  });

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const port = configService.get<number>("PORT", 4000);
  await app.listen(port);
  logger.log(`NEXUSTHEME API is running on: http://localhost:${port}`);
  logger.log(`CORS allowed origins: ${allowedOrigins.join(", ")}`);
}

bootstrap();
