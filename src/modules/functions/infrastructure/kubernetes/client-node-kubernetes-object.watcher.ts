import * as k8s from '@kubernetes/client-node';
import { Observable } from 'rxjs';
import { KubernetesObjectResource } from './kubernetes-object.client';
import {
  KubernetesObjectWatcher,
  KubernetesWatchEvent,
  KubernetesWatchEventType,
} from './kubernetes-object.watcher';

interface AbortableRequest {
  abort(): void;
}

export class ClientNodeKubernetesObjectWatcher implements KubernetesObjectWatcher {
  private readonly watcher: k8s.Watch;

  constructor(kubeConfig: k8s.KubeConfig) {
    this.watcher = new k8s.Watch(kubeConfig);
  }

  watch(
    apiVersion: string,
    kind: string,
    namespace: string,
    labelSelector?: string,
  ): Observable<KubernetesWatchEvent> {
    const path = resourcePath(apiVersion, kind, namespace);

    return new Observable((subscriber) => {
      let request: AbortableRequest | undefined;
      let stopped = false;

      void this.watcher
        .watch(
          path,
          {
            ...(labelSelector === undefined ? {} : { labelSelector }),
          },
          (type: string, resource: unknown) => {
            if (type === 'ERROR') {
              subscriber.error(watchError(resource));
              return;
            }
            if (isWatchEventType(type) && isKubernetesResource(resource)) {
              subscriber.next({ type, resource });
            }
          },
          (error: unknown) => {
            if (stopped) {
              return;
            }
            if (error === null || error === undefined) {
              subscriber.complete();
            } else {
              subscriber.error(asError(error));
            }
          },
        )
        .then((activeRequest: AbortableRequest) => {
          request = activeRequest;
          if (stopped) {
            request.abort();
          }
        })
        .catch((error: unknown) => subscriber.error(asError(error)));

      return () => {
        stopped = true;
        request?.abort();
      };
    });
  }
}

function resourcePath(
  apiVersion: string,
  kind: string,
  namespace: string,
): string {
  const [group, version] = apiVersion.split('/');
  if (group === undefined || version === undefined) {
    throw new Error(
      `watch requires a grouped Kubernetes apiVersion: ${apiVersion}`,
    );
  }

  return `/apis/${group}/${version}/namespaces/${namespace}/${pluralize(kind)}`;
}

function pluralize(kind: string): string {
  return `${kind.toLowerCase()}s`;
}

function isWatchEventType(value: string): value is KubernetesWatchEventType {
  return ['ADDED', 'MODIFIED', 'DELETED', 'BOOKMARK', 'ERROR'].includes(value);
}

function isKubernetesResource(
  value: unknown,
): value is KubernetesObjectResource {
  return (
    typeof value === 'object' &&
    value !== null &&
    'apiVersion' in value &&
    'kind' in value &&
    'metadata' in value
  );
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function watchError(resource: unknown): Error {
  if (typeof resource === 'object' && resource !== null) {
    const message = (resource as Record<string, unknown>).message;
    if (typeof message === 'string') {
      return new Error(`Kubernetes watch failed: ${message.slice(0, 500)}`);
    }
  }
  return new Error('Kubernetes watch returned an error event');
}
