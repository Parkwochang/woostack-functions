import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Environment } from '../../shared/config/environment';
import { ManagementAuthGuard } from '../auth/presentation/http/management-auth.guard';
import { FunctionsApplicationService } from './application/functions.application-service';
import { FUNCTION_RUNTIME_PORT } from './domain/function-runtime.port';
import {
  ClientNodeKubernetesObjectClient,
  createKubeConfig,
} from './infrastructure/kubernetes/client-node-kubernetes-object.client';
import {
  KUBERNETES_OBJECT_CLIENT,
  KubernetesObjectClient,
} from './infrastructure/kubernetes/kubernetes-object.client';
import { KnativeManifestFactory } from './infrastructure/knative/knative-manifest.factory';
import { KnativeRuntimeAdapter } from './infrastructure/knative/knative-runtime.adapter';
import { FunctionsController } from './presentation/http/functions.controller';

@Module({
  controllers: [FunctionsController],
  providers: [
    FunctionsApplicationService,
    ManagementAuthGuard,
    {
      provide: KUBERNETES_OBJECT_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) =>
        new ClientNodeKubernetesObjectClient(createKubeConfig(config)),
    },
    {
      provide: FUNCTION_RUNTIME_PORT,
      inject: [KUBERNETES_OBJECT_CLIENT, ConfigService],
      useFactory: (
        client: KubernetesObjectClient,
        config: ConfigService<Environment, true>,
      ) => {
        const namespace = config.get('FUNCTION_NAMESPACE', { infer: true });
        const serviceAccount = config.get('FUNCTION_SERVICE_ACCOUNT', {
          infer: true,
        });
        return new KnativeRuntimeAdapter(
          client,
          new KnativeManifestFactory(namespace, serviceAccount),
          namespace,
        );
      },
    },
  ],
  exports: [FunctionsApplicationService],
})
export class FunctionsModule {}
