import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cookieParser = require('cookie-parser');
import helmet from 'helmet';
import { AppModule } from './app.module';
import { Env } from './infrastructure/config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Sets security headers including Strict-Transport-Security (§10).
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // OpenAPI / Swagger UI at /docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('MedAlign Backend API')
    .setVersion('0.1.0')
    .setDescription(
      'MedAlign backend API. Authentication uses an HttpOnly `access_token` cookie ' +
        'set on POST /auth/2fa/verify. All non-GET requests require an ' +
        '`x-csrf-token` header matching the value returned by the CSRF middleware.',
    )
    .addCookieAuth('access_token')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });
  await app.listen(port);
}

bootstrap().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
