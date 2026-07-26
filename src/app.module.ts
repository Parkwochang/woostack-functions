import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FunctionsModule } from './modules/functions/functions.module';
import { FunctionsExceptionFilter } from './modules/functions/presentation/http/functions-exception.filter';
import { Environment, validateEnvironment } from './shared/config/environment';
import { ObservabilityModule } from './shared/observability/observability.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers.set-cookie',
            ],
            censor: '[Redacted]',
          },
          autoLogging: {
            ignore: (request) =>
              request.url === '/healthz' ||
              request.url === '/readyz' ||
              request.url === '/metrics',
          },
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => [
        {
          ttl: config.get('MANAGEMENT_THROTTLE_TTL_MS', { infer: true }),
          limit: config.get('MANAGEMENT_THROTTLE_LIMIT', { infer: true }),
        },
      ],
    }),
    FunctionsModule,
    ObservabilityModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: FunctionsExceptionFilter,
    },
  ],
})
export class AppModule {}
