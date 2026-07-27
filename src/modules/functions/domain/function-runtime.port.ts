import { FunctionDefinition } from './function-definition';
import { FunctionName } from './function-name';

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

export interface FunctionRuntimePort {
  check(): Promise<void>;
  list(): Promise<FunctionView[]>;
  get(name: FunctionName): Promise<FunctionView>;
  apply(
    name: FunctionName,
    definition: FunctionDefinition,
  ): Promise<FunctionView>;
  delete(name: FunctionName): Promise<FunctionView | undefined>;
  render(name: FunctionName, definition: FunctionDefinition): unknown;
}

export const FUNCTION_RUNTIME_PORT = Symbol('FUNCTION_RUNTIME_PORT');
