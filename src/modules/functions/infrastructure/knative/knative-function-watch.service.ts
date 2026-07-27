import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitterReadinessWatcher, OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { defer, filter, map, repeat, retry, Subscription, timer } from 'rxjs';
import {
  FUNCTION_EVENT_PUBLISHER,
  FunctionAppliedEvent,
  FunctionDeletedEvent,
  FunctionEventPublisher,
  FunctionStateChangedEvent,
} from '../../domain/function-event';
import {
  FunctionState,
  FunctionView,
} from '../../domain/function-runtime.port';
import { Environment } from '../../../../shared/config/environment';
import {
  KUBERNETES_OBJECT_WATCHER,
  KubernetesObjectWatcher,
  KubernetesWatchEvent,
} from '../kubernetes/kubernetes-object.watcher';
import { MANAGED_BY_LABEL, MANAGED_BY_VALUE } from './knative-manifest.factory';
import { mapKnativeService } from './knative-runtime.adapter';

const API_VERSION = 'serving.knative.dev/v1';
const KIND = 'Service';
const RECONNECT_DELAY_MS = 1_000;

@Injectable()
export class KnativeFunctionWatchService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(KnativeFunctionWatchService.name);
  private readonly states = new Map<string, FunctionState>();
  private subscription?: Subscription;

  constructor(
    @Inject(KUBERNETES_OBJECT_WATCHER)
    private readonly watcher: KubernetesObjectWatcher,
    @Inject(FUNCTION_EVENT_PUBLISHER)
    private readonly events: FunctionEventPublisher,
    private readonly eventEmitterReadiness: EventEmitterReadinessWatcher,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.eventEmitterReadiness.waitUntilReady();

    this.subscription = defer(() =>
      this.watcher.watch(
        API_VERSION,
        KIND,
        this.config.get('FUNCTION_NAMESPACE', { infer: true }),
        `${MANAGED_BY_LABEL}=${MANAGED_BY_VALUE}`,
      ),
    )
      .pipe(
        filter(isResourceEvent),
        map((event) => ({
          type: event.type,
          view: mapKnativeService(event.resource),
        })),
        retry({
          delay: (error, retryCount) => {
            this.logger.warn(
              { err: asError(error), retryCount },
              'Knative watch failed; reconnecting',
            );
            return timer(RECONNECT_DELAY_MS);
          },
        }),
        repeat({ delay: RECONNECT_DELAY_MS }),
      )
      .subscribe(({ type, view }) => this.handle(type, view));
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  @OnEvent('function.applied', { suppressErrors: true })
  seedAppliedState(event: FunctionAppliedEvent): void {
    this.states.set(
      `${event.function.namespace}/${event.function.name}`,
      event.function.state,
    );
  }

  @OnEvent('function.deleted', { suppressErrors: true })
  removeDeletedState(event: FunctionDeletedEvent): void {
    this.states.delete(`${event.namespace}/${event.name}`);
  }

  private handle(type: 'ADDED' | 'MODIFIED' | 'DELETED', view: FunctionView) {
    const key = `${view.namespace}/${view.name}`;
    if (type === 'DELETED') {
      this.states.delete(key);
      return;
    }

    const previousState = this.states.get(key);
    this.states.set(key, view.state);

    // Initial ADDED events establish the local baseline after each watch starts.
    if (previousState === undefined || previousState === view.state) {
      return;
    }

    const event = stateEvent('function.state.changed', view, previousState);
    this.events.publish(event);

    if (view.state === 'ready') {
      this.events.publish({
        ...event,
        eventId: randomUUID(),
        type: 'function.ready',
      });
    } else if (view.state === 'failed') {
      this.events.publish({
        ...event,
        eventId: randomUUID(),
        type: 'function.failed',
      });
    }
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isResourceEvent(
  event: KubernetesWatchEvent,
): event is KubernetesWatchEvent & {
  type: 'ADDED' | 'MODIFIED' | 'DELETED';
} {
  return (
    event.type === 'ADDED' ||
    event.type === 'MODIFIED' ||
    event.type === 'DELETED'
  );
}

function stateEvent(
  type: FunctionStateChangedEvent['type'],
  view: FunctionView,
  previousState: FunctionState,
): FunctionStateChangedEvent {
  return {
    type,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    name: view.name,
    namespace: view.namespace,
    previousState,
    currentState: view.state,
    function: view,
  };
}
