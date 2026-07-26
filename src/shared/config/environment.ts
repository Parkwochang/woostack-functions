import { z } from 'zod';

const booleanFromEnvironment = z.preprocess((value) => {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return value;
}, z.boolean().optional());

const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  API_DOCS_ENABLED: booleanFromEnvironment,
  FUNCTION_NAMESPACE: z
    .string()
    .regex(/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/)
    .default('functions'),
  FUNCTION_SERVICE_ACCOUNT: z
    .string()
    .regex(/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/)
    .default('function-runtime'),
  FUNCTION_API_TOKEN: optionalString,
  FUNCTION_ALLOW_INSECURE_LOCAL: booleanFromEnvironment.default(false),
  KUBERNETES_API_URL: z.url().optional(),
  KUBERNETES_TOKEN: optionalString,
  KUBERNETES_TOKEN_FILE: z
    .string()
    .default('/var/run/secrets/kubernetes.io/serviceaccount/token'),
  KUBERNETES_CA_FILE: z
    .string()
    .default('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt'),
  KUBERNETES_SKIP_TLS_VERIFY: booleanFromEnvironment.default(false),
  MANAGEMENT_THROTTLE_TTL_MS: z.coerce.number().int().min(1000).default(60_000),
  MANAGEMENT_THROTTLE_LIMIT: z.coerce.number().int().min(1).default(120),
});

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  values: Record<string, unknown>,
): Environment {
  const result = environmentSchema.safeParse(values);
  if (result.success) {
    return result.data;
  }

  const message = result.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid environment configuration: ${message}`);
}
