import { FunctionDefinition } from '../../domain/function-definition';
import { FunctionName } from '../../domain/function-name';
import { KnativeManifestFactory } from './knative-manifest.factory';

describe('KnativeManifestFactory', () => {
  const factory = new KnativeManifestFactory('functions', 'function-runtime');

  it('renders a private, scale-to-zero Knative Service', () => {
    const manifest = factory.build(
      FunctionName.create('hello'),
      FunctionDefinition.fromUnknown({
        image: 'harbor.woostack.dev/functions/hello:202607120001',
        env: { GREETING: 'hello' },
        secretRefs: ['hello-secrets'],
      }),
    );
    const metadata = manifest.metadata as {
      labels: Record<string, string>;
    };
    const spec = manifest.spec as {
      template: {
        metadata: { annotations: Record<string, string> };
        spec: {
          serviceAccountName: string;
          containerConcurrency: number;
          timeoutSeconds: number;
          containers: unknown[];
        };
      };
    };

    expect(metadata.labels).toMatchObject({
      'app.kubernetes.io/managed-by': 'woostack-functions',
      'networking.knative.dev/visibility': 'cluster-local',
    });
    expect(spec.template.metadata.annotations).toMatchObject({
      'autoscaling.knative.dev/min-scale': '0',
      'autoscaling.knative.dev/max-scale': '10',
      'queue.sidecar.serving.knative.dev/cpu-resource-request': '25m',
      'queue.sidecar.serving.knative.dev/memory-resource-limit': '128Mi',
    });
    expect(spec.template.spec).toMatchObject({
      serviceAccountName: 'function-runtime',
      containerConcurrency: 10,
      timeoutSeconds: 30,
    });
    expect(spec.template.spec.containers[0]).toMatchObject({
      name: 'function',
      image: 'harbor.woostack.dev/functions/hello:202607120001',
      securityContext: {
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: true,
      },
      resources: {
        requests: { 'ephemeral-storage': '16Mi' },
        limits: { 'ephemeral-storage': '64Mi' },
      },
    });
  });

  it('omits the cluster-local label for external functions', () => {
    const manifest = factory.build(
      FunctionName.create('public-hello'),
      FunctionDefinition.fromUnknown({
        image: 'harbor.woostack.dev/functions/hello:202607120001',
        visibility: 'external',
      }),
    );
    const labels = manifest.metadata.labels as Record<string, string>;

    expect(labels['networking.knative.dev/visibility']).toBeUndefined();
  });
});
