import { FunctionDefinition } from '../../domain/function-definition';
import { FunctionName } from '../../domain/function-name';
import { KubernetesObjectResource } from '../kubernetes/kubernetes-object.client';

export const MANAGED_BY_LABEL = 'app.kubernetes.io/managed-by';
export const MANAGED_BY_VALUE = 'woostack-functions';

export class KnativeManifestFactory {
  constructor(
    private readonly namespace: string,
    private readonly serviceAccountName: string,
  ) {}

  build(
    functionName: FunctionName,
    definition: FunctionDefinition,
  ): KubernetesObjectResource {
    const name = functionName.value;
    const spec = definition.toPrimitives();
    const labels: Record<string, string> = {
      'app.kubernetes.io/name': name,
      [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
      'platform.woostack.dev/function': name,
    };

    if (spec.visibility === 'cluster-local') {
      labels['networking.knative.dev/visibility'] = 'cluster-local';
    }

    return {
      apiVersion: 'serving.knative.dev/v1',
      kind: 'Service',
      metadata: {
        name,
        namespace: this.namespace,
        labels,
        ...(spec.description === undefined
          ? {}
          : {
              annotations: {
                'platform.woostack.dev/description': spec.description,
              },
            }),
      },
      spec: {
        template: {
          metadata: {
            labels: {
              'app.kubernetes.io/name': name,
              [MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
            },
            annotations: {
              'autoscaling.knative.dev/metric': 'concurrency',
              'autoscaling.knative.dev/min-scale': String(
                spec.scaling.minScale,
              ),
              'autoscaling.knative.dev/max-scale': String(
                spec.scaling.maxScale,
              ),
              'autoscaling.knative.dev/target': String(
                spec.scaling.targetConcurrency,
              ),
              'queue.sidecar.serving.knative.dev/cpu-resource-request': '25m',
              'queue.sidecar.serving.knative.dev/cpu-resource-limit': '100m',
              'queue.sidecar.serving.knative.dev/memory-resource-request':
                '50Mi',
              'queue.sidecar.serving.knative.dev/memory-resource-limit':
                '128Mi',
              'queue.sidecar.serving.knative.dev/ephemeral-storage-resource-request':
                '16Mi',
              'queue.sidecar.serving.knative.dev/ephemeral-storage-resource-limit':
                '64Mi',
            },
          },
          spec: {
            serviceAccountName: this.serviceAccountName,
            containerConcurrency: spec.scaling.targetConcurrency,
            timeoutSeconds: spec.timeoutSeconds,
            containers: [
              {
                name: 'function',
                image: spec.image,
                imagePullPolicy: 'IfNotPresent',
                ports: [{ name: 'http1', containerPort: spec.port }],
                env: Object.entries(spec.env)
                  .sort(([left], [right]) => left.localeCompare(right))
                  .map(([envName, value]) => ({ name: envName, value })),
                envFrom: [
                  ...spec.configMapRefs.map((resourceName) => ({
                    configMapRef: { name: resourceName },
                  })),
                  ...spec.secretRefs.map((resourceName) => ({
                    secretRef: { name: resourceName },
                  })),
                ],
                resources: {
                  requests: {
                    ...spec.resources.requests,
                    'ephemeral-storage': '16Mi',
                  },
                  limits: {
                    ...spec.resources.limits,
                    'ephemeral-storage': '64Mi',
                  },
                },
                securityContext: {
                  allowPrivilegeEscalation: false,
                  capabilities: { drop: ['ALL'] },
                  readOnlyRootFilesystem: true,
                  runAsNonRoot: true,
                  seccompProfile: { type: 'RuntimeDefault' },
                },
                volumeMounts: [{ name: 'tmp', mountPath: '/tmp' }],
              },
            ],
            volumes: [{ name: 'tmp', emptyDir: { sizeLimit: '64Mi' } }],
          },
        },
        traffic: [{ latestRevision: true, percent: 100 }],
      },
    };
  }
}
