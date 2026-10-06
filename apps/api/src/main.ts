import { NestFactory } from "@nestjs/core";
import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter";
import { StructuredLoggingInterceptor } from "./common/interceptors/structured-logging.interceptor";
import { resolveCorsOrigins } from "./common/cors";
import { describeFeatureFlags } from "./common/feature-flags";

async function bootstrap() {
  const logger = new Logger("Bootstrap");
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const configService = app.get(ConfigService);

  // Fails closed in production on missing/insecure frontend origins.
  const allowedOrigins = resolveCorsOrigins(process.env);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // Behind Caddy/Cloudflare: trust the first proxy hop for client IPs.
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.enableShutdownHooks();

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
  await app.listen(port, "0.0.0.0");
  logger.log(`NEXUSTHEME API is running on port ${port}`);
  logger.log(`CORS allowed origins: ${allowedOrigins.join(", ")}`);
  logger.log(`Feature flags: ${describeFeatureFlags()}`);
}

bootstrap();
