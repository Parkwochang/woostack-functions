import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FunctionDefinition } from '../domain/function-definition';
import {
  FUNCTION_EVENT_PUBLISHER,
  FunctionEventPublisher,
} from '../domain/function-event';
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
    @Inject(FUNCTION_EVENT_PUBLISHER)
    private readonly events: FunctionEventPublisher,
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

  async apply(rawName: string, body: unknown): Promise<FunctionView> {
    const name = FunctionName.create(rawName);
    const definition = FunctionDefinition.fromUnknown(body);
    definition.assertSecretOwnership(name);
    const view = await this.runtime.apply(name, definition);
    this.events.publish({
      type: 'function.applied',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      name: view.name,
      namespace: view.namespace,
      function: view,
    });
    return view;
  }

  render(rawName: string, body: unknown): unknown {
    const name = FunctionName.create(rawName);
    const definition = FunctionDefinition.fromUnknown(body);
    definition.assertSecretOwnership(name);
    return this.runtime.render(name, definition);
  }

  async delete(rawName: string): Promise<{ name: string; deleted: true }> {
    const name = FunctionName.create(rawName);
    const deleted = await this.runtime.delete(name);
    if (deleted !== undefined) {
      this.events.publish({
        type: 'function.deleted',
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        name: name.value,
        namespace: deleted.namespace,
      });
    }
    return { name: name.value, deleted: true };
  }
}
