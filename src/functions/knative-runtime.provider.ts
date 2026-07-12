import {
  KubernetesApi,
  KubernetesApiError,
} from '../kubernetes/kubernetes-api.client';
import {
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
  KnativeManifestFactory,
} from './knative-manifest.factory';
import {
  FunctionRuntime,
  FunctionSpec,
  FunctionState,
  FunctionView,
} from './function.types';

interface KnativeCondition {
  type?: string;
  status?: string;
  reason?: string;
  message?: string;
}

interface KnativeServiceResource {
  metadata?: {
    name?: string;
    namespace?: string;
    generation?: number;
    creationTimestamp?: string;
    labels?: Record<string, string>;
  };
  spec?: {
    template?: {
      spec?: {
        containers?: Array<{ image?: string }>;
      };
    };
  };
  status?: {
    observedGeneration?: number;
    url?: string;
    latestReadyRevisionName?: string;
    conditions?: KnativeCondition[];
  };
}

export class UnmanagedFunctionError extends Error {
  constructor(name: string) {
    super(`Knative Service ${name} is not managed by ${MANAGED_BY_VALUE}`);
    this.name = 'UnmanagedFunctionError';
  }
}

interface KnativeServiceList {
  items?: KnativeServiceResource[];
}

export class KnativeRuntimeProvider implements FunctionRuntime {
  private readonly collectionPath: string;

  constructor(
    private readonly client: KubernetesApi,
    private readonly factory: KnativeManifestFactory,
    private readonly namespace: string,
  ) {
    this.collectionPath = `/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(namespace)}/services`;
  }

  async check(): Promise<void> {
    await this.client.request('GET', `${this.collectionPath}?limit=1`);
  }

  async list(): Promise<FunctionView[]> {
    const query = new URLSearchParams({
      labelSelector: `${MANAGED_BY_LABEL}=${MANAGED_BY_VALUE}`,
    });
    const response = await this.client.request<KnativeServiceList>(
      'GET',
      `${this.collectionPath}?${query.toString()}`,
    );

    return (response.items ?? []).map((item) => mapService(item));
  }

  async get(name: string): Promise<FunctionView> {
    const response = await this.read(name);
    assertManaged(name, response);

    return mapService(response);
  }

  async apply(name: string, spec: FunctionSpec): Promise<FunctionView> {
    const query = new URLSearchParams({ fieldManager: MANAGED_BY_VALUE });
    const manifest = this.factory.build(name, spec);
    let response: KnativeServiceResource;

    try {
      const existing = await this.read(name);
      assertManaged(name, existing);
      response = await this.client.request<KnativeServiceResource>(
        'PATCH',
        `${this.resourcePath(name)}?${query.toString()}`,
        manifest,
        'application/apply-patch+yaml',
      );
    } catch (error) {
      if (!(error instanceof KubernetesApiError) || error.statusCode !== 404) {
        throw error;
      }

      response = await this.client.request<KnativeServiceResource>(
        'POST',
        `${this.collectionPath}?${query.toString()}`,
        manifest,
      );
    }

    return mapService(response);
  }

  async delete(name: string): Promise<void> {
    try {
      const existing = await this.read(name);
      assertManaged(name, existing);
      await this.client.request('DELETE', this.resourcePath(name));
    } catch (error) {
      if (
        error instanceof KubernetesApiError &&
        error.statusCode === 404 &&
        isNamedResourceNotFound(error.response, name)
      ) {
        return;
      }
      throw error;
    }
  }

  render(name: string, spec: FunctionSpec): unknown {
    return this.factory.build(name, spec);
  }

  private resourcePath(name: string): string {
    return `${this.collectionPath}/${encodeURIComponent(name)}`;
  }

  private read(name: string): Promise<KnativeServiceResource> {
    return this.client.request<KnativeServiceResource>(
      'GET',
      this.resourcePath(name),
    );
  }
}

function mapService(resource: KnativeServiceResource): FunctionView {
  const ready = resource.status?.conditions?.find(
    (condition) => condition.type === 'Ready',
  );
  const generation = resource.metadata?.generation;
  const observedGeneration = resource.status?.observedGeneration;
  const isStale =
    generation !== undefined &&
    observedGeneration !== undefined &&
    observedGeneration < generation;
  const state = mapState(ready, isStale);

  return {
    name: resource.metadata?.name ?? 'unknown',
    namespace: resource.metadata?.namespace ?? 'unknown',
    image: resource.spec?.template?.spec?.containers?.[0]?.image ?? 'unknown',
    state,
    ...(resource.metadata?.generation === undefined
      ? {}
      : { generation: resource.metadata.generation }),
    ...(resource.metadata?.creationTimestamp === undefined
      ? {}
      : { createdAt: resource.metadata.creationTimestamp }),
    ...(resource.status?.url === undefined ? {} : { url: resource.status.url }),
    ...(isStale || resource.status?.latestReadyRevisionName === undefined
      ? {}
      : { revision: resource.status.latestReadyRevisionName }),
    ...(ready?.reason === undefined ? {} : { reason: ready.reason }),
    ...(ready?.message === undefined ? {} : { message: ready.message }),
  };
}

function mapState(
  condition: KnativeCondition | undefined,
  isStale: boolean,
): FunctionState {
  if (isStale) {
    return 'deploying';
  }
  if (condition?.status === 'True') {
    return 'ready';
  }
  if (condition?.status === 'False') {
    return 'failed';
  }
  return 'deploying';
}

function assertManaged(name: string, resource: KnativeServiceResource): void {
  if (resource.metadata?.labels?.[MANAGED_BY_LABEL] !== MANAGED_BY_VALUE) {
    throw new UnmanagedFunctionError(name);
  }
}

function isNamedResourceNotFound(response: unknown, name: string): boolean {
  if (typeof response !== 'object' || response === null) {
    return false;
  }
  const details = (response as Record<string, unknown>).details;
  if (typeof details !== 'object' || details === null) {
    return false;
  }
  return (details as Record<string, unknown>).name === name;
}
