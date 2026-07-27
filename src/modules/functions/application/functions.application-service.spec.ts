import {
  FunctionEvent,
  FunctionEventPublisher,
} from '../domain/function-event';
import {
  FunctionRuntimePort,
  FunctionView,
} from '../domain/function-runtime.port';
import { FunctionsApplicationService } from './functions.application-service';

class RecordingEventPublisher implements FunctionEventPublisher {
  readonly events: FunctionEvent[] = [];

  publish(event: FunctionEvent): void {
    this.events.push(event);
  }
}

class StubRuntime implements FunctionRuntimePort {
  constructor(private readonly deleted?: FunctionView) {}

  check(): Promise<void> {
    return Promise.resolve();
  }

  list(): Promise<FunctionView[]> {
    return Promise.resolve([]);
  }

  get(): Promise<FunctionView> {
    return Promise.resolve(functionView());
  }

  apply(): Promise<FunctionView> {
    return Promise.resolve(functionView());
  }

  delete(): Promise<FunctionView | undefined> {
    return Promise.resolve(this.deleted);
  }

  render(): unknown {
    return {};
  }
}

describe('FunctionsApplicationService events', () => {
  it('publishes function.applied after the runtime succeeds', async () => {
    const events = new RecordingEventPublisher();
    const service = new FunctionsApplicationService(new StubRuntime(), events);

    await service.apply('hello', {
      image: 'harbor.woostack.dev/functions/hello:1',
    });

    expect(events.events).toHaveLength(1);
    expect(events.events[0]).toMatchObject({
      type: 'function.applied',
      name: 'hello',
      namespace: 'functions',
    });
  });

  it('publishes function.deleted only when a resource was removed', async () => {
    const events = new RecordingEventPublisher();
    const service = new FunctionsApplicationService(
      new StubRuntime(functionView()),
      events,
    );

    await service.delete('hello');

    expect(events.events).toHaveLength(1);
    expect(events.events[0]).toMatchObject({
      type: 'function.deleted',
      name: 'hello',
      namespace: 'functions',
    });
  });

  it('does not publish a deletion event for an idempotent no-op', async () => {
    const events = new RecordingEventPublisher();
    const service = new FunctionsApplicationService(new StubRuntime(), events);

    await service.delete('hello');

    expect(events.events).toEqual([]);
  });
});

function functionView(): FunctionView {
  return {
    name: 'hello',
    namespace: 'functions',
    image: 'harbor.woostack.dev/functions/hello:1',
    state: 'deploying',
  };
}
