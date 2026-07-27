import { ConfigService } from '@nestjs/config';
import { EventEmitterReadinessWatcher } from '@nestjs/event-emitter';
import { Subject } from 'rxjs';
import {
  FunctionEvent,
  FunctionEventPublisher,
} from '../../domain/function-event';
import {
  KubernetesObjectWatcher,
  KubernetesWatchEvent,
} from '../kubernetes/kubernetes-object.watcher';
import { Environment } from '../../../../shared/config/environment';
import { KnativeFunctionWatchService } from './knative-function-watch.service';

class SubjectWatcher implements KubernetesObjectWatcher {
  readonly events = new Subject<KubernetesWatchEvent>();

  watch() {
    return this.events;
  }
}

class RecordingEventPublisher implements FunctionEventPublisher {
  readonly events: FunctionEvent[] = [];

  publish(event: FunctionEvent): void {
    this.events.push(event);
  }
}

describe('KnativeFunctionWatchService', () => {
  it('emits state and terminal events only after the initial state changes', async () => {
    const watcher = new SubjectWatcher();
    const events = new RecordingEventPublisher();
    const service = new KnativeFunctionWatchService(
      watcher,
      events,
      {
        waitUntilReady: () => Promise.resolve(),
      } as EventEmitterReadinessWatcher,
      {
        get: () => 'functions',
      } as unknown as ConfigService<Environment, true>,
    );
    await service.onApplicationBootstrap();

    watcher.events.next({
      type: 'ADDED',
      resource: knativeService('Unknown'),
    });
    watcher.events.next({
      type: 'MODIFIED',
      resource: knativeService('True'),
    });

    expect(events.events.map(({ type }) => type)).toEqual([
      'function.state.changed',
      'function.ready',
    ]);
    expect(events.events[0]).toMatchObject({
      previousState: 'deploying',
      currentState: 'ready',
      name: 'hello',
    });

    service.onModuleDestroy();
  });
});

function knativeService(readyStatus: string) {
  return {
    apiVersion: 'serving.knative.dev/v1',
    kind: 'Service',
    metadata: {
      name: 'hello',
      namespace: 'functions',
      generation: 1,
      labels: {
        'app.kubernetes.io/managed-by': 'woostack-functions',
      },
    },
    spec: {
      template: {
        spec: {
          containers: [{ image: 'harbor.woostack.dev/functions/hello:1' }],
        },
      },
    },
    status: {
      observedGeneration: 1,
      latestReadyRevisionName: 'hello-00001',
      conditions: [{ type: 'Ready', status: readyStatus }],
    },
  };
}
