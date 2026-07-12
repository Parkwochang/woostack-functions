import { Module } from '@nestjs/common';
import { ManagementAuthGuard } from '../auth/management-auth.guard';
import { KubernetesApiClient } from '../kubernetes/kubernetes-api.client';
import { FUNCTION_RUNTIME } from './function.types';
import { FunctionsController } from './functions.controller';
import { FunctionsService } from './functions.service';
import { KnativeManifestFactory } from './knative-manifest.factory';
import { KnativeRuntimeProvider } from './knative-runtime.provider';

@Module({
  controllers: [FunctionsController],
  providers: [
    FunctionsService,
    ManagementAuthGuard,
    {
      provide: FUNCTION_RUNTIME,
      useFactory: () => {
        const namespace = process.env.FUNCTION_NAMESPACE ?? 'functions';
        const serviceAccount =
          process.env.FUNCTION_SERVICE_ACCOUNT ?? 'function-runtime';

        return new KnativeRuntimeProvider(
          new KubernetesApiClient(),
          new KnativeManifestFactory(namespace, serviceAccount),
          namespace,
        );
      },
    },
  ],
  exports: [FunctionsService],
})
export class FunctionsModule {}
