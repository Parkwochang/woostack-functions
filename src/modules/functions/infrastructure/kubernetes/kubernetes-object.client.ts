export interface KubernetesObjectResource {
  apiVersion: string;
  kind: string;
  metadata: {
    name?: string;
    namespace?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface KubernetesObjectList {
  items?: KubernetesObjectResource[];
  metadata?: {
    continue?: string;
    resourceVersion?: string;
  };
}

export interface KubernetesObjectClient {
  list(
    apiVersion: string,
    kind: string,
    namespace: string,
    labelSelector?: string,
    limit?: number,
  ): Promise<KubernetesObjectList>;
  read(resource: KubernetesObjectResource): Promise<KubernetesObjectResource>;
  create(
    resource: KubernetesObjectResource,
    fieldManager: string,
  ): Promise<KubernetesObjectResource>;
  apply(
    resource: KubernetesObjectResource,
    fieldManager: string,
  ): Promise<KubernetesObjectResource>;
  delete(resource: KubernetesObjectResource): Promise<void>;
}

export class KubernetesClientError extends Error {
  constructor(
    readonly statusCode: number,
    readonly response: unknown,
    options?: ErrorOptions,
  ) {
    super(`Kubernetes API request failed with status ${statusCode}`, options);
    this.name = 'KubernetesClientError';
  }
}

export class KubernetesClientTransportError extends Error {
  constructor(options?: ErrorOptions) {
    super('Kubernetes API transport failed', options);
    this.name = 'KubernetesClientTransportError';
  }
}

export const KUBERNETES_OBJECT_CLIENT = Symbol('KUBERNETES_OBJECT_CLIENT');
