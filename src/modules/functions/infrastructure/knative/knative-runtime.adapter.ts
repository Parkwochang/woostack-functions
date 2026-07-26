import { FunctionDefinition } from '../../domain/function-definition';
import {
  FunctionRuntimeError,
  UnmanagedFunctionError,
} from '../../domain/function.errors';
import { FunctionName } from '../../domain/function-name';
import {
  FunctionRuntimePort,
  FunctionState,
  FunctionView,
} from '../../domain/function-runtime.port';
import {
  KubernetesClientError,
  KubernetesClientTransportError,
  KubernetesObjectClient,
  KubernetesObjectResource,
} from '../kubernetes/kubernetes-object.client';
import {
  MANAGED_BY_LABEL,
  MANAGED_BY_VALUE,
  KnativeManifestFactory,
} from './knative-manifest.factory';

const API_VERSION = 'serving.knative.dev/v1';
const KIND = 'Service';

interface KnativeCondition {
  type?: string;
  status?: string;
  reason?: string;
  message?: string;
}

interface KnativeServiceResource extends KubernetesObjectResource {
  metadata: KubernetesObjectResource['metadata'] & {
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

export class KnativeRuntimeAdapter implements FunctionRuntimePort {
  constructor(
    private readonly client: KubernetesObjectClient,
    private readonly factory: KnativeManifestFactory,
    private readonly namespace: string,
  ) {}

  async check(): Promise<void> {
    try {
      await this.client.list(API_VERSION, KIND, this.namespace, undefined, 1);
    } catch (error) {
      throw new FunctionRuntimeError(
        'unavailable',
        'Knative Serving API is not reachable or not installed',
        undefined,
        undefined,
        { cause: error },
      );
    }
  }

  async list(): Promise<FunctionView[]> {
    const response = await this.execute(() =>
      this.client.list(
        API_VERSION,
        KIND,
        this.namespace,
        `${MANAGED_BY_LABEL}=${MANAGED_BY_VALUE}`,
      ),
    );

    return (response.items ?? []).map((item) =>
      mapService(item as KnativeServiceResource),
    );
  }

  async get(name: FunctionName): Promise<FunctionView> {
    const response = await this.read(name);
    assertManaged(name, response);
    return mapService(response);
  }

  async apply(
    name: FunctionName,
    definition: FunctionDefinition,
  ): Promise<FunctionView> {
    const manifest = this.factory.build(name, definition);

    try {
      const existing = await this.client.read(
        resourceHeader(name, this.namespace),
      );
      assertManaged(name, existing);
      const response = await this.client.apply(manifest, MANAGED_BY_VALUE);
      return mapService(response);
    } catch (error) {
      if (error instanceof KubernetesClientError && error.statusCode === 404) {
        const response = await this.execute(() =>
          this.client.create(manifest, MANAGED_BY_VALUE),
        );
        return mapService(response);
      }
      throw normalizeRuntimeError(error);
    }
  }

  async delete(name: FunctionName): Promise<void> {
    try {
      const existing = await this.client.read(
        resourceHeader(name, this.namespace),
      );
      assertManaged(name, existing);
      await this.client.delete(resourceHeader(name, this.namespace));
    } catch (error) {
      if (
        error instanceof KubernetesClientError &&
        error.statusCode === 404 &&
        isNamedResourceNotFound(error.response, name.value)
      ) {
        return;
      }
      throw normalizeRuntimeError(error);
    }
  }

  render(name: FunctionName, definition: FunctionDefinition): unknown {
    return this.factory.build(name, definition);
  }

  private async read(name: FunctionName): Promise<KnativeServiceResource> {
    const response = await this.execute(() =>
      this.client.read(resourceHeader(name, this.namespace)),
    );
    return response;
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw normalizeRuntimeError(error);
    }
  }
}

function resourceHeader(
  name: FunctionName,
  namespace: string,
): KubernetesObjectResource {
  return {
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: {
      name: name.value,
      namespace,
    },
  };
}

function mapService(resource: KnativeServiceResource): FunctionView {
  const ready = resource.status?.conditions?.find(
    (condition) => condition.type === 'Ready',
  );
  const generation = resource.metadata.generation;
  const observedGeneration = resource.status?.observedGeneration;
  const isStale =
    generation !== undefined &&
    observedGeneration !== undefined &&
    observedGeneration < generation;
  const state = mapState(ready, isStale);

  return {
    name: resource.metadata.name ?? 'unknown',
    namespace: resource.metadata.namespace ?? 'unknown',
    image: resource.spec?.template?.spec?.containers?.[0]?.image ?? 'unknown',
    state,
    ...(generation === undefined ? {} : { generation }),
    ...(resource.metadata.creationTimestamp === undefined
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

function assertManaged(
  name: FunctionName,
  resource: KnativeServiceResource,
): void {
  if (resource.metadata.labels?.[MANAGED_BY_LABEL] !== MANAGED_BY_VALUE) {
    throw new UnmanagedFunctionError(name.value);
  }
}

function normalizeRuntimeError(error: unknown): Error {
  if (
    error instanceof FunctionRuntimeError ||
    error instanceof UnmanagedFunctionError
  ) {
    return error;
  }

  if (error instanceof KubernetesClientTransportError) {
    return new FunctionRuntimeError(
      'unavailable',
      'Kubernetes API is unavailable; check control-plane connectivity',
      undefined,
      undefined,
      { cause: error },
    );
  }

  if (error instanceof KubernetesClientError) {
    const detail = kubernetesStatusMessage(error.response);

    if (error.statusCode === 400 || error.statusCode === 422) {
      return new FunctionRuntimeError(
        'rejected',
        'Knative rejected the function specification',
        error.statusCode,
        detail,
        { cause: error },
      );
    }
    if (error.statusCode === 404) {
      return new FunctionRuntimeError(
        'not-found',
        'function was not found',
        404,
        detail,
        { cause: error },
      );
    }
    if (error.statusCode === 409) {
      return new FunctionRuntimeError(
        'conflict',
        'function update conflicted; retry the request',
        409,
        detail,
        { cause: error },
      );
    }
    if (error.statusCode === 401 || error.statusCode === 403) {
      return new FunctionRuntimeError(
        'forbidden',
        'control plane is not authorized to manage Knative Services',
        error.statusCode,
        detail,
        { cause: error },
      );
    }
    if (error.statusCode === 429) {
      return new FunctionRuntimeError(
        'rate-limited',
        'Kubernetes API rate limit exceeded; retry the request',
        429,
        detail,
        { cause: error },
      );
    }
    return new FunctionRuntimeError(
      'upstream',
      'Knative Serving API request failed',
      error.statusCode,
      detail,
      { cause: error },
    );
  }

  return error instanceof Error ? error : new Error(String(error));
}

function kubernetesStatusMessage(response: unknown): string | undefined {
  if (typeof response !== 'object' || response === null) {
    return undefined;
  }

  const message = (response as Record<string, unknown>).message;
  return typeof message === 'string' ? message.slice(0, 500) : undefined;
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
