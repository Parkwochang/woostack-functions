import { Observable } from 'rxjs';
import { KubernetesObjectResource } from './kubernetes-object.client';

export type KubernetesWatchEventType =
  'ADDED' | 'MODIFIED' | 'DELETED' | 'BOOKMARK' | 'ERROR';

export interface KubernetesWatchEvent {
  type: KubernetesWatchEventType;
  resource: KubernetesObjectResource;
}

export interface KubernetesObjectWatcher {
  watch(
    apiVersion: string,
    kind: string,
    namespace: string,
    labelSelector?: string,
  ): Observable<KubernetesWatchEvent>;
}

export const KUBERNETES_OBJECT_WATCHER = Symbol('KUBERNETES_OBJECT_WATCHER');
