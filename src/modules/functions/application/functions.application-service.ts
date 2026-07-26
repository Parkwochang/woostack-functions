import { Inject, Injectable } from '@nestjs/common';
import { FunctionDefinition } from '../domain/function-definition';
import { FunctionName } from '../domain/function-name';
import {
  FUNCTION_RUNTIME_PORT,
  FunctionRuntimePort,
  FunctionView,
} from '../domain/function-runtime.port';

@Injectable()
export class FunctionsApplicationService {
  constructor(
    @Inject(FUNCTION_RUNTIME_PORT)
    private readonly runtime: FunctionRuntimePort,
  ) {}

  checkRuntime(): Promise<void> {
    return this.runtime.check();
  }

  list(): Promise<FunctionView[]> {
    return this.runtime.list();
  }

  get(rawName: string): Promise<FunctionView> {
    return this.runtime.get(FunctionName.create(rawName));
  }

  apply(rawName: string, body: unknown): Promise<FunctionView> {
    const name = FunctionName.create(rawName);
    const definition = FunctionDefinition.fromUnknown(body);
    definition.assertSecretOwnership(name);
    return this.runtime.apply(name, definition);
  }

  render(rawName: string, body: unknown): unknown {
    const name = FunctionName.create(rawName);
    const definition = FunctionDefinition.fromUnknown(body);
    definition.assertSecretOwnership(name);
    return this.runtime.render(name, definition);
  }

  async delete(rawName: string): Promise<{ name: string; deleted: true }> {
    const name = FunctionName.create(rawName);
    await this.runtime.delete(name);
    return { name: name.value, deleted: true };
  }
}
