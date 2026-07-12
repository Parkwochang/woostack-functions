import {
  KubernetesApi,
  KubernetesApiError,
} from '../kubernetes/kubernetes-api.client';
import { parseFunctionSpec } from './function-spec.parser';
import { KnativeManifestFactory } from './knative-manifest.factory';
import {
  KnativeRuntimeProvider,
  UnmanagedFunctionError,
} from './knative-runtime.provider';

interface RecordedRequest {
  method: string;
  path: string;
  body?: unknown;
  contentType?: string;
}

class FakeKubernetesApi implements KubernetesApi {
  readonly requests: RecordedRequest[] = [];

  constructor(private readonly responses: unknown[]) {}

  request<T>(
    method: string,
    path: string,
    body?: unknown,
    contentType?: string,
  ): Promise<T> {
    this.requests.push({ method, path, body, contentType });
    const response = this.responses.shift();
    if (response instanceof Error) {
      return Promise.reject(response);
    }
    return Promise.resolve(response as T);
  }
}

describe('KnativeRuntimeProvider', () => {
  const factory = new KnativeManifestFactory('functions', 'function-runtime');
  const spec = parseFunctionSpec({
    image: 'harbor.woostack.dev/functions/hello:1',
  });

  it('creates a missing function without forcing field ownership', async () => {
    const client = new FakeKubernetesApi([
      new KubernetesApiError(404, {}),
      managedResource(),
    ]);
    const provider = new KnativeRuntimeProvider(client, factory, 'functions');

    await expect(provider.apply('hello', spec)).resolves.toMatchObject({
      name: 'hello',
      state: 'ready',
    });
    expect(client.requests.map(({ method }) => method)).toEqual([
      'GET',
      'POST',
    ]);
    expect(client.requests[1].path).toContain(
      'fieldManager=woostack-functions',
    );
    expect(client.requests[1].path).not.toContain('force=');
  });

  it('updates only a function already owned by the platform', async () => {
    const client = new FakeKubernetesApi([
      managedResource(),
      managedResource(),
    ]);
    const provider = new KnativeRuntimeProvider(client, factory, 'functions');

    await provider.apply('hello', spec);

    expect(client.requests.map(({ method }) => method)).toEqual([
      'GET',
      'PATCH',
    ]);
    expect(client.requests[1].contentType).toBe('application/apply-patch+yaml');
    expect(client.requests[1].path).not.toContain('force=');
  });

  it('refuses to take over an unmanaged Knative Service', async () => {
    const client = new FakeKubernetesApi([unmanagedResource()]);
    const provider = new KnativeRuntimeProvider(client, factory, 'functions');

    await expect(provider.apply('hello', spec)).rejects.toThrow(
      UnmanagedFunctionError,
    );
    expect(client.requests).toHaveLength(1);
  });

  it('refuses to delete an unmanaged Knative Service', async () => {
    const client = new FakeKubernetesApi([unmanagedResource()]);
    const provider = new KnativeRuntimeProvider(client, factory, 'functions');

    await expect(provider.delete('hello')).rejects.toThrow(
      UnmanagedFunctionError,
    );
    expect(client.requests).toHaveLength(1);
  });

  it('treats a missing named function as an idempotent delete', async () => {
    const client = new FakeKubernetesApi([
      new KubernetesApiError(404, { details: { name: 'hello' } }),
    ]);
    const provider = new KnativeRuntimeProvider(client, factory, 'functions');

    await expect(provider.delete('hello')).resolves.toBeUndefined();
  });

  it('does not hide a missing Knative API as a successful delete', async () => {
    const client = new FakeKubernetesApi([
      new KubernetesApiError(404, {
        message: 'the server could not find the requested resource',
      }),
    ]);
    const provider = new KnativeRuntimeProvider(client, factory, 'functions');

    await expect(provider.delete('hello')).rejects.toBeInstanceOf(
      KubernetesApiError,
    );
  });

  it('reports a stale ready condition as deploying', async () => {
    const client = new FakeKubernetesApi([
      managedResource({ generation: 2, observedGeneration: 1 }),
    ]);
    const provider = new KnativeRuntimeProvider(client, factory, 'functions');

    const result = await provider.get('hello');

    expect(result).toMatchObject({ state: 'deploying' });
    expect(result.revision).toBeUndefined();
  });

  it('reports Ready=Unknown as deploying', async () => {
    const client = new FakeKubernetesApi([
      managedResource({ readyStatus: 'Unknown' }),
    ]);
    const provider = new KnativeRuntimeProvider(client, factory, 'functions');

    await expect(provider.get('hello')).resolves.toMatchObject({
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
) {
  const generation = options.generation ?? 1;
  return {
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

function unmanagedResource() {
  return {
    ...managedResource(),
    metadata: {
      name: 'hello',
      namespace: 'functions',
      labels: { 'app.kubernetes.io/managed-by': 'argocd' },
    },
  };
}
