import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'node:fs';
import * as k8s from '@kubernetes/client-node';
import { Environment } from '../../../../shared/config/environment';
import {
  KubernetesClientError,
  KubernetesClientTransportError,
  KubernetesObjectClient,
  KubernetesObjectList,
  KubernetesObjectResource,
} from './kubernetes-object.client';

export class ClientNodeKubernetesObjectClient implements KubernetesObjectClient {
  private readonly api: k8s.KubernetesObjectApi;

  constructor(kubeConfig: k8s.KubeConfig) {
    this.api = k8s.KubernetesObjectApi.makeApiClient(kubeConfig);
  }

  async list(
    apiVersion: string,
    kind: string,
    namespace: string,
    labelSelector?: string,
    limit?: number,
  ): Promise<KubernetesObjectList> {
    return this.execute(async () => {
      const response = await this.api.list(
        apiVersion,
        kind,
        namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        labelSelector,
        limit,
      );
      return response.body as KubernetesObjectList;
    });
  }

  async read(
    resource: KubernetesObjectResource,
  ): Promise<KubernetesObjectResource> {
    return this.execute(async () => {
      const response = await this.api.read(asKubernetesObjectHeader(resource));
      return response.body as KubernetesObjectResource;
    });
  }

  async create(
    resource: KubernetesObjectResource,
    fieldManager: string,
  ): Promise<KubernetesObjectResource> {
    return this.execute(async () => {
      const response = await this.api.create(
        asKubernetesObject(resource),
        undefined,
        undefined,
        fieldManager,
      );
      return response.body as KubernetesObjectResource;
    });
  }

  async apply(
    resource: KubernetesObjectResource,
    fieldManager: string,
  ): Promise<KubernetesObjectResource> {
    return this.execute(async () => {
      const response = await this.api.patch(
        asKubernetesObject(resource),
        undefined,
        undefined,
        fieldManager,
        undefined,
        {
          headers: {
            'Content-Type': k8s.PatchUtils.PATCH_FORMAT_APPLY_YAML,
          },
        },
      );
      return response.body as KubernetesObjectResource;
    });
  }

  async delete(resource: KubernetesObjectResource): Promise<void> {
    await this.execute(async () => {
      await this.api.delete(asKubernetesObject(resource));
    });
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof k8s.HttpError) {
        throw new KubernetesClientError(
          error.statusCode ?? error.response.statusCode ?? 500,
          error.body,
          { cause: error },
        );
      }
      throw new KubernetesClientTransportError({ cause: asError(error) });
    }
  }
}

export function createKubeConfig(
  config: ConfigService<Environment, true>,
): k8s.KubeConfig {
  const kubeConfig = new k8s.KubeConfig();
  const apiUrl = config.get('KUBERNETES_API_URL', { infer: true });

  if (apiUrl !== undefined) {
    const token =
      config.get('KUBERNETES_TOKEN', { infer: true }) ??
      readOptionalFile(config.get('KUBERNETES_TOKEN_FILE', { infer: true }));
    const caFile = config.get('KUBERNETES_CA_FILE', { infer: true });

    kubeConfig.loadFromOptions({
      clusters: [
        {
          name: 'functions-runtime',
          server: apiUrl,
          skipTLSVerify: config.get('KUBERNETES_SKIP_TLS_VERIFY', {
            infer: true,
          }),
          ...(existsSync(caFile) ? { caFile } : {}),
        },
      ],
      users: [
        {
          name: 'functions-runtime',
          ...(token === undefined ? {} : { token }),
        },
      ],
      contexts: [
        {
          name: 'functions-runtime',
          cluster: 'functions-runtime',
          user: 'functions-runtime',
        },
      ],
      currentContext: 'functions-runtime',
    });
    return kubeConfig;
  }

  if (process.env.KUBERNETES_SERVICE_HOST !== undefined) {
    kubeConfig.loadFromCluster();
    return kubeConfig;
  }

  kubeConfig.loadFromDefault();
  return kubeConfig;
}

function asKubernetesObject(
  resource: KubernetesObjectResource,
): k8s.KubernetesObject {
  return resource;
}

function asKubernetesObjectHeader(
  resource: KubernetesObjectResource,
): k8s.KubernetesObject & {
  metadata: { name: string; namespace?: string };
} {
  return resource as k8s.KubernetesObject & {
    metadata: { name: string; namespace?: string };
  };
}

function readOptionalFile(path: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  const value = readFileSync(path, 'utf8').trim();
  return value.length === 0 ? undefined : value;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
