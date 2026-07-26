import { FunctionDefinition } from '../../domain/function-definition';
import { UnmanagedFunctionError } from '../../domain/function.errors';
import { FunctionName } from '../../domain/function-name';
import {
  KubernetesClientError,
  KubernetesObjectClient,
  KubernetesObjectList,
  KubernetesObjectResource,
} from '../kubernetes/kubernetes-object.client';
import { KnativeManifestFactory } from './knative-manifest.factory';
import { KnativeRuntimeAdapter } from './knative-runtime.adapter';

interface RecordedRequest {
  operation: string;
  resource?: KubernetesObjectResource;
  fieldManager?: string;
}

class FakeKubernetesObjectClient implements KubernetesObjectClient {
  readonly requests: RecordedRequest[] = [];

  constructor(private readonly responses: unknown[]) {}

  list(): Promise<KubernetesObjectList> {
    this.requests.push({ operation: 'list' });
    return this.next<KubernetesObjectList>();
  }

  read(resource: KubernetesObjectResource): Promise<KubernetesObjectResource> {
    this.requests.push({ operation: 'read', resource });
    return this.next<KubernetesObjectResource>();
  }

  create(
    resource: KubernetesObjectResource,
    fieldManager: string,
  ): Promise<KubernetesObjectResource> {
    this.requests.push({ operation: 'create', resource, fieldManager });
    return this.next<KubernetesObjectResource>();
  }

  apply(
    resource: KubernetesObjectResource,
    fieldManager: string,
  ): Promise<KubernetesObjectResource> {
    this.requests.push({ operation: 'apply', resource, fieldManager });
    return this.next<KubernetesObjectResource>();
  }

  delete(resource: KubernetesObjectResource): Promise<void> {
    this.requests.push({ operation: 'delete', resource });
    return this.next<void>();
  }

  private next<T>(): Promise<T> {
    const response = this.responses.shift();
    if (response instanceof Error) {
      return Promise.reject(response);
    }
    return Promise.resolve(response as T);
  }
}

describe('KnativeRuntimeAdapter', () => {
  const factory = new KnativeManifestFactory('functions', 'function-runtime');
  const definition = FunctionDefinition.fromUnknown({
    image: 'harbor.woostack.dev/functions/hello:1',
  });
  const name = FunctionName.create('hello');

  it('creates a missing function without forcing field ownership', async () => {
    const client = new FakeKubernetesObjectClient([
      new KubernetesClientError(404, {}),
      managedResource(),
    ]);
    const adapter = new KnativeRuntimeAdapter(client, factory, 'functions');

    await expect(adapter.apply(name, definition)).resolves.toMatchObject({
      name: 'hello',
      state: 'ready',
    });
    expect(client.requests.map(({ operation }) => operation)).toEqual([
      'read',
      'create',
    ]);
    expect(client.requests[1].fieldManager).toBe('woostack-functions');
  });

  it('updates only a function already owned by the platform', async () => {
    const client = new FakeKubernetesObjectClient([
      managedResource(),
      managedResource(),
    ]);
    const adapter = new KnativeRuntimeAdapter(client, factory, 'functions');

    await adapter.apply(name, definition);

    expect(client.requests.map(({ operation }) => operation)).toEqual([
      'read',
      'apply',
    ]);
    expect(client.requests[1].fieldManager).toBe('woostack-functions');
  });

  it('refuses to take over an unmanaged Knative Service', async () => {
    const client = new FakeKubernetesObjectClient([unmanagedResource()]);
    const adapter = new KnativeRuntimeAdapter(client, factory, 'functions');

    await expect(adapter.apply(name, definition)).rejects.toThrow(
      UnmanagedFunctionError,
    );
    expect(client.requests).toHaveLength(1);
  });

  it('refuses to delete an unmanaged Knative Service', async () => {
    const client = new FakeKubernetesObjectClient([unmanagedResource()]);
    const adapter = new KnativeRuntimeAdapter(client, factory, 'functions');

    await expect(adapter.delete(name)).rejects.toThrow(UnmanagedFunctionError);
    expect(client.requests).toHaveLength(1);
  });

  it('treats a missing named function as an idempotent delete', async () => {
    const client = new FakeKubernetesObjectClient([
      new KubernetesClientError(404, { details: { name: 'hello' } }),
    ]);
    const adapter = new KnativeRuntimeAdapter(client, factory, 'functions');

    await expect(adapter.delete(name)).resolves.toBeUndefined();
  });

  it('does not hide a missing Knative API as a successful delete', async () => {
    const client = new FakeKubernetesObjectClient([
      new KubernetesClientError(404, {
        message: 'the server could not find the requested resource',
      }),
    ]);
    const adapter = new KnativeRuntimeAdapter(client, factory, 'functions');

    await expect(adapter.delete(name)).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('reports a stale ready condition as deploying', async () => {
    const client = new FakeKubernetesObjectClient([
      managedResource({ generation: 2, observedGeneration: 1 }),
    ]);
    const adapter = new KnativeRuntimeAdapter(client, factory, 'functions');

    const result = await adapter.get(name);

    expect(result).toMatchObject({ state: 'deploying' });
    expect(result.revision).toBeUndefined();
  });

  it('reports Ready=Unknown as deploying', async () => {
    const client = new FakeKubernetesObjectClient([
      managedResource({ readyStatus: 'Unknown' }),
    ]);
    const adapter = new KnativeRuntimeAdapter(client, factory, 'functions');

    await expect(adapter.get(name)).resolves.toMatchObject({
      state: 'deploying',
    });
  });
});

function managedResource(
  options: {
    generation?: number;
    observedGeneration?: number;
    readyStatus?: string;
  } = {},
): KubernetesObjectResource {
  const generation = options.generation ?? 1;
  return {
    apiVersion: 'serving.knative.dev/v1',
    kind: 'Service',
    metadata: {
      name: 'hello',
      namespace: 'functions',
      generation,
      labels: { 'app.kubernetes.io/managed-by': 'woostack-functions' },
    },
    spec: {
      template: {
        spec: {
          containers: [{ image: 'harbor.woostack.dev/functions/hello:1' }],
        },
      },
    },
    status: {
      observedGeneration: options.observedGeneration ?? generation,
      latestReadyRevisionName: 'hello-00001',
      conditions: [{ type: 'Ready', status: options.readyStatus ?? 'True' }],
    },
  };
}

function unmanagedResource(): KubernetesObjectResource {
  return {
    ...managedResource(),
    metadata: {
      name: 'hello',
      namespace: 'functions',
      labels: { 'app.kubernetes.io/managed-by': 'argocd' },
    },
  };
}
