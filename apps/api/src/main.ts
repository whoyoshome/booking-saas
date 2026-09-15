import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Demo/prod free stack (Vercel → Render): set CORS_ORIGIN to the web
  // origin(s), comma-separated. Local/dev keeps wide open when unset.
  const corsOrigin = process.env.CORS_ORIGIN;
  app.enableCors(
    corsOrigin
      ? {
          origin: corsOrigin.split(',').map((o) => o.trim()),
          credentials: true,
        }
      : undefined,
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // whitelist: strips undeclared DTO fields instead of passing them through
  // silently. forbidNonWhitelisted: returns 400 on extra fields — we prefer
  // failing loudly over letting a client believe a field is being used when
  // it is not.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // PORT is what Render/Fly inject; bind 0.0.0.0 so the platform proxy
  // can reach the process inside the container.
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`API listening on http://0.0.0.0:${port}`);
}

bootstrap();
