export class FunctionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FunctionValidationError';
  }
}

export class UnmanagedFunctionError extends Error {
  constructor(name: string) {
    super(`Knative Service ${name} is not managed by woostack-functions`);
    this.name = 'UnmanagedFunctionError';
  }
}

export type FunctionRuntimeErrorCode =
  | 'not-found'
  | 'rejected'
  | 'conflict'
  | 'forbidden'
  | 'rate-limited'
  | 'unavailable'
  | 'upstream';

export class FunctionRuntimeError extends Error {
  constructor(
    readonly code: FunctionRuntimeErrorCode,
    message: string,
    readonly statusCode?: number,
    readonly detail?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'FunctionRuntimeError';
  }
}
