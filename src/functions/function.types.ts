export type FunctionVisibility = 'cluster-local' | 'external';

export interface FunctionResources {
  requests: {
    cpu: string;
    memory: string;
  };
  limits: {
    cpu: string;
    memory: string;
  };
}

export interface FunctionScaling {
  minScale: number;
  maxScale: number;
  targetConcurrency: number;
}

export interface FunctionSpec {
  image: string;
  description?: string;
  port: number;
  timeoutSeconds: number;
  visibility: FunctionVisibility;
  env: Record<string, string>;
  configMapRefs: string[];
  secretRefs: string[];
  resources: FunctionResources;
  scaling: FunctionScaling;
}

export type FunctionState = 'deploying' | 'ready' | 'failed' | 'unknown';

export interface FunctionView {
  name: string;
  namespace: string;
  image: string;
  generation?: number;
  createdAt?: string;
  state: FunctionState;
  url?: string;
  revision?: string;
  reason?: string;
  message?: string;
}

export interface FunctionRuntime {
  check(): Promise<void>;
  list(): Promise<FunctionView[]>;
  get(name: string): Promise<FunctionView>;
  apply(name: string, spec: FunctionSpec): Promise<FunctionView>;
  delete(name: string): Promise<void>;
  render(name: string, spec: FunctionSpec): unknown;
}

export const FUNCTION_RUNTIME = Symbol('FUNCTION_RUNTIME');
