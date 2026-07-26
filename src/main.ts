import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { Environment } from './shared/config/environment';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Environment, true>);

  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.enableShutdownHooks();

  const docsEnabled =
    config.get('API_DOCS_ENABLED', { infer: true }) ??
    config.get('NODE_ENV', { infer: true }) !== 'production';
  if (docsEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Woostack Functions API')
      .setDescription('Kubernetes-native serverless control plane')
      .setVersion('0.0.1')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
