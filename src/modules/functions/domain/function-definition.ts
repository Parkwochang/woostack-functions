import { FunctionValidationError } from './function.errors';
import { FunctionName } from './function-name';

export type FunctionVisibility = 'cluster-local' | 'external';

export interface FunctionResources {
  requests: {
    cpu: string;
    memory: string;
  };
  limits: {
    cpu: string;
    memory: string;
  };
}

export interface FunctionScaling {
  minScale: number;
  maxScale: number;
  targetConcurrency: number;
}

export interface FunctionDefinitionProps {
  image: string;
  description?: string;
  port: number;
  timeoutSeconds: number;
  visibility: FunctionVisibility;
  env: Record<string, string>;
  configMapRefs: string[];
  secretRefs: string[];
  resources: FunctionResources;
  scaling: FunctionScaling;
}

const DNS_LABEL = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CPU_QUANTITY = /^(?:\d+m|\d+(?:\.\d+)?)$/;
const MEMORY_QUANTITY = /^\d+(?:Ki|Mi|Gi)$/;
const OCI_IMAGE_REFERENCE =
  /^(?:[a-z0-9]+(?:[.-][a-z0-9]+)*(?::\d{1,5})?\/)?(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|@sha256:[a-fA-F0-9]{64})$/;
const RESERVED_ENV_NAMES = new Set([
  'PORT',
  'K_SERVICE',
  'K_REVISION',
  'K_CONFIGURATION',
]);
const ALLOWED_FIELDS = new Set([
  'image',
  'description',
  'port',
  'timeoutSeconds',
  'visibility',
  'env',
  'configMapRefs',
  'secretRefs',
  'resources',
  'scaling',
]);

const defaults: Omit<FunctionDefinitionProps, 'image' | 'description'> = {
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
};

export class FunctionDefinition {
  private constructor(private readonly props: FunctionDefinitionProps) {}

  static fromUnknown(value: unknown): FunctionDefinition {
    return new FunctionDefinition(parseDefinition(value));
  }

  assertSecretOwnership(name: FunctionName): void {
    if (this.props.secretRefs.length > 1) {
      invalid('MVP functions can reference at most one Secret');
    }

    const expectedName = `${name.value}-secrets`;
    for (const secretName of this.props.secretRefs) {
      if (secretName !== expectedName) {
        invalid(`secretRefs entry ${secretName} must be named ${expectedName}`);
      }
    }
  }

  toPrimitives(): FunctionDefinitionProps {
    return structuredClone(this.props);
  }
}

function parseDefinition(value: unknown): FunctionDefinitionProps {
  const input = object(value, 'body');

  for (const field of Object.keys(input)) {
    if (!ALLOWED_FIELDS.has(field)) {
      invalid(`unknown field: ${field}`);
    }
  }

  const image = requiredString(input.image, 'image', 512);
  validateImage(image);

  const description = optionalString(input.description, 'description', 200);
  const port = optionalInteger(input.port, 'port', 1, 65535) ?? defaults.port;
  const timeoutSeconds =
    optionalInteger(input.timeoutSeconds, 'timeoutSeconds', 1, 600) ??
    defaults.timeoutSeconds;
  const visibility = parseVisibility(input.visibility);
  const env = parseEnvironment(input.env);
  const configMapRefs = parseResourceNames(
    input.configMapRefs,
    'configMapRefs',
  );
  const secretRefs = parseResourceNames(input.secretRefs, 'secretRefs');
  const resources = parseResources(input.resources);
  const scaling = parseScaling(input.scaling);

  if (scaling.minScale > scaling.maxScale) {
    invalid('scaling.minScale must be less than or equal to scaling.maxScale');
  }

  return {
    image,
    ...(description === undefined ? {} : { description }),
    port,
    timeoutSeconds,
    visibility,
    env,
    configMapRefs,
    secretRefs,
    resources,
    scaling,
  };
}

function parseVisibility(value: unknown): FunctionVisibility {
  if (value === undefined) {
    return defaults.visibility;
  }

  if (value !== 'cluster-local' && value !== 'external') {
    invalid('visibility must be either cluster-local or external');
  }

  return value;
}

function parseEnvironment(value: unknown): Record<string, string> {
  if (value === undefined) {
    return {};
  }

  const entries = object(value, 'env');
  if (Object.keys(entries).length > 64) {
    invalid('env can contain at most 64 entries');
  }

  return Object.fromEntries(
    Object.entries(entries).map(([name, envValue]) => {
      if (!ENV_NAME.test(name)) {
        invalid(`env key is invalid: ${name}`);
      }
      if (RESERVED_ENV_NAMES.has(name)) {
        invalid(`env.${name} is reserved by the function runtime`);
      }
      if (typeof envValue !== 'string' || envValue.length > 4096) {
        invalid(`env.${name} must be a string with at most 4096 characters`);
      }
      return [name, envValue];
    }),
  );
}

function parseResourceNames(value: unknown, field: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 16) {
    invalid(`${field} must be an array with at most 16 entries`);
  }

  return value.map((item, index) => {
    if (typeof item !== 'string' || item.length > 63 || !DNS_LABEL.test(item)) {
      invalid(`${field}[${index}] must be a Kubernetes DNS label`);
    }
    return item;
  });
}

function parseResources(value: unknown): FunctionResources {
  if (value === undefined) {
    return structuredClone(defaults.resources);
  }

  const resources = object(value, 'resources');
  rejectUnknown(resources, 'resources', ['requests', 'limits']);
  const requests = nestedQuantities(
    resources.requests,
    'resources.requests',
    defaults.resources.requests,
  );
  const limits = nestedQuantities(
    resources.limits,
    'resources.limits',
    defaults.resources.limits,
  );

  if (cpuInMillicores(requests.cpu) > cpuInMillicores(limits.cpu)) {
    invalid('resources.requests.cpu must not exceed resources.limits.cpu');
  }
  if (memoryInKi(requests.memory) > memoryInKi(limits.memory)) {
    invalid(
      'resources.requests.memory must not exceed resources.limits.memory',
    );
  }

  return { requests, limits };
}

function nestedQuantities(
  value: unknown,
  field: string,
  fallback: { cpu: string; memory: string },
) {
  if (value === undefined) {
    return { ...fallback };
  }

  const quantities = object(value, field);
  rejectUnknown(quantities, field, ['cpu', 'memory']);
  const cpu =
    optionalString(quantities.cpu, `${field}.cpu`, 32) ?? fallback.cpu;
  const memory =
    optionalString(quantities.memory, `${field}.memory`, 32) ?? fallback.memory;

  if (!CPU_QUANTITY.test(cpu)) {
    invalid(`${field}.cpu must be a CPU quantity such as 25m or 1`);
  }
  if (!MEMORY_QUANTITY.test(memory)) {
    invalid(`${field}.memory must use Ki, Mi, or Gi`);
  }
  if (cpuInMillicores(cpu) <= 0 || memoryInKi(memory) <= 0) {
    invalid(`${field} quantities must be greater than zero`);
  }

  return { cpu, memory };
}

function parseScaling(value: unknown): FunctionScaling {
  if (value === undefined) {
    return { ...defaults.scaling };
  }

  const scaling = object(value, 'scaling');
  rejectUnknown(scaling, 'scaling', [
    'minScale',
    'maxScale',
    'targetConcurrency',
  ]);

  return {
    minScale:
      optionalInteger(scaling.minScale, 'scaling.minScale', 0, 10) ??
      defaults.scaling.minScale,
    maxScale:
      optionalInteger(scaling.maxScale, 'scaling.maxScale', 1, 20) ??
      defaults.scaling.maxScale,
    targetConcurrency:
      optionalInteger(
        scaling.targetConcurrency,
        'scaling.targetConcurrency',
        1,
        1000,
      ) ?? defaults.scaling.targetConcurrency,
  };
}

function validateImage(image: string): void {
  if (!OCI_IMAGE_REFERENCE.test(image)) {
    invalid(
      'image must be a valid lowercase OCI repository with a tag or sha256 digest',
    );
  }
  if (image.endsWith(':latest')) {
    invalid('image tag latest is not allowed; use an immutable version tag');
  }
}

function cpuInMillicores(value: string): number {
  return value.endsWith('m')
    ? Number(value.slice(0, -1))
    : Number(value) * 1000;
}

function memoryInKi(value: string): number {
  const amount = Number(value.slice(0, -2));
  if (value.endsWith('Gi')) {
    return amount * 1024 * 1024;
  }
  if (value.endsWith('Mi')) {
    return amount * 1024;
  }
  return amount;
}

function rejectUnknown(
  value: Record<string, unknown>,
  field: string,
  allowed: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      invalid(`unknown field: ${field}.${key}`);
    }
  }
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    invalid(
      `${field} must be a non-empty string with at most ${max} characters`,
    );
  }
  return value;
}

function optionalString(
  value: unknown,
  field: string,
  max: number,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredString(value, field, max);
}

function optionalInteger(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    !Number.isInteger(value) ||
    (value as number) < min ||
    (value as number) > max
  ) {
    invalid(`${field} must be an integer between ${min} and ${max}`);
  }
  return value as number;
}

function invalid(message: string): never {
  throw new FunctionValidationError(message);
}
