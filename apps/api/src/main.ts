import { NestFactory } from "@nestjs/core";
import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter";
import { StructuredLoggingInterceptor } from "./common/interceptors/structured-logging.interceptor";

async function bootstrap() {
  const logger = new Logger("Bootstrap");
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const configService = app.get(ConfigService);
  const webUrl = configService.get<string>("WEB_URL", "http://localhost:3000");
  const portalUrl = configService.get<string>(
    "PORTAL_URL",
    "http://localhost:3001",
  );
  const adminUrl = configService.get<string>(
    "ADMIN_URL",
    "http://localhost:3002",
  );

  const allowedOrigins = Array.from(
    new Set([
      webUrl,
      portalUrl,
      adminUrl,
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
    ]),
  );

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
  app.useGlobalInterceptors(new StructuredLoggingInterceptor());

  const port = configService.get<number>("PORT", 4000);
  await app.listen(port);
  logger.log(`NEXUSTHEME API is running on: http://localhost:${port}`);
  logger.log(`CORS allowed origins: ${allowedOrigins.join(", ")}`);
}

bootstrap();
