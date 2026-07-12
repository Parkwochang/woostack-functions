import {
  BadRequestException,
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  KubernetesApiError,
  KubernetesTransportError,
} from '../kubernetes/kubernetes-api.client';
import {
  assertFunctionName,
  assertFunctionSecretRefs,
  parseFunctionSpec,
} from './function-spec.parser';
import {
  FUNCTION_RUNTIME,
  FunctionRuntime,
  FunctionView,
} from './function.types';
import { UnmanagedFunctionError } from './knative-runtime.provider';

@Injectable()
export class FunctionsService {
  constructor(
    @Inject(FUNCTION_RUNTIME)
    private readonly runtime: FunctionRuntime,
  ) {}

  async checkRuntime(): Promise<void> {
    try {
      await this.runtime.check();
    } catch {
      throw new ServiceUnavailableException(
        'Knative Serving API is not reachable or not installed',
      );
    }
  }

  async list(): Promise<FunctionView[]> {
    return this.run(() => this.runtime.list());
  }

  async get(name: string): Promise<FunctionView> {
    assertFunctionName(name);
    return this.run(() => this.runtime.get(name));
  }

  async apply(name: string, body: unknown): Promise<FunctionView> {
    assertFunctionName(name);
    const spec = parseFunctionSpec(body);
    assertFunctionSecretRefs(name, spec);
    return this.run(() => this.runtime.apply(name, spec));
  }

  render(name: string, body: unknown): unknown {
    assertFunctionName(name);
    const spec = parseFunctionSpec(body);
    assertFunctionSecretRefs(name, spec);
    return this.runtime.render(name, spec);
  }

  async delete(name: string): Promise<{ name: string; deleted: true }> {
    assertFunctionName(name);
    await this.run(() => this.runtime.delete(name));
    return { name, deleted: true };
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof UnmanagedFunctionError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof KubernetesApiError) {
        if (error.statusCode === 400 || error.statusCode === 422) {
          const detail = kubernetesStatusMessage(error.response);
          throw new BadRequestException(
            `Knative rejected the function specification with status ${error.statusCode}${detail === undefined ? '' : `: ${detail}`}`,
          );
        }
        if (error.statusCode === 404) {
          throw new NotFoundException('function was not found');
        }
        if (error.statusCode === 409) {
          throw new ConflictException(
            'function update conflicted; retry the request',
          );
        }
        if (error.statusCode === 401 || error.statusCode === 403) {
          throw new ForbiddenException(
            'control plane is not authorized to manage Knative Services',
          );
        }
        if (error.statusCode === 429) {
          throw new HttpException(
            'Kubernetes API rate limit exceeded; retry the request',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        throw new BadGatewayException(
          `Knative Serving API returned status ${error.statusCode}`,
        );
      }
      if (error instanceof KubernetesTransportError) {
        throw new ServiceUnavailableException(
          'Kubernetes API is unavailable; check control-plane connectivity',
        );
      }

      throw error;
    }
  }
}

function kubernetesStatusMessage(response: unknown): string | undefined {
  if (typeof response !== 'object' || response === null) {
    return undefined;
  }

  const message = (response as Record<string, unknown>).message;
  return typeof message === 'string' ? message.slice(0, 500) : undefined;
}
