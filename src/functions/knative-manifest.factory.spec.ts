import { parseFunctionSpec } from './function-spec.parser';
import { KnativeManifestFactory } from './knative-manifest.factory';

describe('KnativeManifestFactory', () => {
  const factory = new KnativeManifestFactory('functions', 'function-runtime');

  it('renders a private, scale-to-zero Knative Service', () => {
    const manifest = factory.build(
      'hello',
      parseFunctionSpec({
        image: 'harbor.woostack.dev/functions/hello:202607120001',
        env: { GREETING: 'hello' },
        secretRefs: ['hello-secrets'],
      }),
    );

    expect(manifest.metadata.labels).toMatchObject({
      'app.kubernetes.io/managed-by': 'woostack-functions',
      'networking.knative.dev/visibility': 'cluster-local',
    });
    expect(manifest.spec.template.metadata.annotations).toMatchObject({
      'autoscaling.knative.dev/min-scale': '0',
      'autoscaling.knative.dev/max-scale': '10',
      'queue.sidecar.serving.knative.dev/cpu-resource-request': '25m',
      'queue.sidecar.serving.knative.dev/memory-resource-limit': '128Mi',
    });
    expect(manifest.spec.template.spec).toMatchObject({
      serviceAccountName: 'function-runtime',
      containerConcurrency: 10,
      timeoutSeconds: 30,
    });
    expect(manifest.spec.template.spec.containers[0]).toMatchObject({
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
      'public-hello',
      parseFunctionSpec({
        image: 'harbor.woostack.dev/functions/hello:202607120001',
        visibility: 'external',
      }),
    );

    expect(
      manifest.metadata.labels['networking.knative.dev/visibility'],
    ).toBeUndefined();
  });
});
