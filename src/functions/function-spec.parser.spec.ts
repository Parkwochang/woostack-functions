import { BadRequestException } from '@nestjs/common';
import {
  assertFunctionSecretRefs,
  parseFunctionSpec,
} from './function-spec.parser';

describe('parseFunctionSpec', () => {
  it('applies safe MVP defaults', () => {
    expect(
      parseFunctionSpec({
        image: 'harbor.woostack.dev/functions/hello:202607120001',
      }),
    ).toEqual({
      image: 'harbor.woostack.dev/functions/hello:202607120001',
      port: 8080,
      timeoutSeconds: 30,
      visibility: 'cluster-local',
      env: {},
      configMapRefs: [],
      secretRefs: [],
      resources: {
        requests: { cpu: '25m', memory: '32Mi' },
        limits: { cpu: '250m', memory: '128Mi' },
      },
      scaling: {
        minScale: 0,
        maxScale: 10,
        targetConcurrency: 10,
      },
    });
  });

  it('rejects mutable latest images', () => {
    expect(() =>
      parseFunctionSpec({
        image: 'harbor.woostack.dev/functions/hello:latest',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects invalid scale bounds', () => {
    expect(() =>
      parseFunctionSpec({
        image: 'harbor.woostack.dev/functions/hello:1',
        scaling: { minScale: 2, maxScale: 1 },
      }),
    ).toThrow(
      'scaling.minScale must be less than or equal to scaling.maxScale',
    );
  });

  it('rejects reserved runtime environment variables', () => {
    expect(() =>
      parseFunctionSpec({
        image: 'harbor.woostack.dev/functions/hello:1',
        env: { PORT: '3000' },
      }),
    ).toThrow('env.PORT is reserved');
  });

  it('rejects Knative runtime environment variables', () => {
    expect(() =>
      parseFunctionSpec({
        image: 'harbor.woostack.dev/functions/hello:1',
        env: { K_REVISION: 'forged' },
      }),
    ).toThrow('env.K_REVISION is reserved');
  });

  it('rejects malformed OCI image references', () => {
    expect(() =>
      parseFunctionSpec({ image: 'https://registry.example.com/image:1' }),
    ).toThrow('image must be a valid lowercase OCI repository');
  });

  it('restricts secrets to the function name prefix', () => {
    const spec = parseFunctionSpec({
      image: 'harbor.woostack.dev/functions/hello:1',
      secretRefs: ['other-function-secret'],
    });

    expect(() => assertFunctionSecretRefs('hello', spec)).toThrow(
      'must be named hello-secrets',
    );
  });

  it('rejects resource requests above their limits', () => {
    expect(() =>
      parseFunctionSpec({
        image: 'harbor.woostack.dev/functions/hello:1',
        resources: {
          requests: { memory: '256Mi' },
          limits: { memory: '128Mi' },
        },
      }),
    ).toThrow(
      'resources.requests.memory must not exceed resources.limits.memory',
    );
  });
});
