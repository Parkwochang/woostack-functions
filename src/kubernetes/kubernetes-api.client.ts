import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest, RequestOptions } from 'node:https';

const SERVICE_ACCOUNT_PATH = '/var/run/secrets/kubernetes.io/serviceaccount';

export interface KubernetesClientOptions {
  apiUrl: string;
  token?: string;
  tokenFile?: string;
  ca?: Buffer;
  rejectUnauthorized: boolean;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface KubernetesApi {
  request<T>(
    method: string,
    path: string,
    body?: unknown,
    contentType?: string,
  ): Promise<T>;
}

export class KubernetesApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly response: unknown,
  ) {
    super(`Kubernetes API request failed with status ${statusCode}`);
    this.name = 'KubernetesApiError';
  }
}

export class KubernetesTransportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'KubernetesTransportError';
  }
}

export class KubernetesApiClient implements KubernetesApi {
  private readonly options: KubernetesClientOptions;

  constructor(options: KubernetesClientOptions = optionsFromEnvironment()) {
    this.options = options;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    contentType = 'application/json',
  ): Promise<T> {
    const url = new URL(path, this.options.apiUrl);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string | number> = {
      accept: 'application/json',
    };

    if (payload !== undefined) {
      headers['content-type'] = contentType;
      headers['content-length'] = Buffer.byteLength(payload);
    }
    let token: string | undefined;
    try {
      token = this.readToken();
    } catch (error) {
      throw new KubernetesTransportError(
        'Failed to read the Kubernetes API authentication token',
        { cause: error },
      );
    }
    if (token !== undefined) {
      headers.authorization = `Bearer ${token}`;
    }

    const requestOptions: RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method,
      headers,
      ca: this.options.ca,
      rejectUnauthorized: this.options.rejectUnauthorized,
    };

    return new Promise<T>((resolve, reject) => {
      const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = request(requestOptions, (response) => {
        const chunks: Buffer[] = [];
        let responseBytes = 0;

        response.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          responseBytes += buffer.length;
          if (responseBytes > this.options.maxResponseBytes) {
            response.destroy(
              new KubernetesTransportError(
                `Kubernetes API response exceeds ${this.options.maxResponseBytes} bytes`,
              ),
            );
            return;
          }
          chunks.push(buffer);
        });
        response.once('error', (error) => {
          reject(asTransportError(error));
        });
        response.once('aborted', () => {
          reject(
            new KubernetesTransportError('Kubernetes API response was aborted'),
          );
        });
        response.on('end', () => {
          const responseText = Buffer.concat(chunks).toString('utf8');
          const responseBody = parseResponse(responseText);
          const statusCode = response.statusCode ?? 500;

          if (statusCode < 200 || statusCode >= 300) {
            reject(new KubernetesApiError(statusCode, responseBody));
            return;
          }

          resolve(responseBody as T);
        });
      });

      req.setTimeout(this.options.timeoutMs, () => {
        req.destroy(
          new Error(
            `Kubernetes API request timed out after ${this.options.timeoutMs}ms`,
          ),
        );
      });
      req.on('error', (error) => {
        reject(asTransportError(error));
      });

      if (payload !== undefined) {
        req.write(payload);
      }
      req.end();
    });
  }

  private readToken(): string | undefined {
    if (this.options.token !== undefined && this.options.token.length > 0) {
      return this.options.token;
    }
    if (
      this.options.tokenFile !== undefined &&
      existsSync(this.options.tokenFile)
    ) {
      const token = readFileSync(this.options.tokenFile, 'utf8').trim();
      return token.length === 0 ? undefined : token;
    }
    return undefined;
  }
}

function optionsFromEnvironment(): KubernetesClientOptions {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? '443';
  const apiUrl =
    process.env.KUBERNETES_API_URL ??
    (host === undefined
      ? 'https://kubernetes.default.svc'
      : `https://${host}:${port}`);
  const tokenFile =
    process.env.KUBERNETES_TOKEN_FILE ?? `${SERVICE_ACCOUNT_PATH}/token`;
  const caFile =
    process.env.KUBERNETES_CA_FILE ?? `${SERVICE_ACCOUNT_PATH}/ca.crt`;
  const timeout = Number(process.env.KUBERNETES_API_TIMEOUT_MS ?? '5000');
  const maxResponseBytes = Number(
    process.env.KUBERNETES_MAX_RESPONSE_BYTES ?? String(5 * 1024 * 1024),
  );
  const explicitToken = process.env.KUBERNETES_TOKEN;

  return {
    apiUrl: apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`,
    token:
      explicitToken === undefined || explicitToken.length === 0
        ? undefined
        : explicitToken,
    tokenFile:
      explicitToken === undefined || explicitToken.length === 0
        ? tokenFile
        : undefined,
    ca: existsSync(caFile) ? readFileSync(caFile) : undefined,
    rejectUnauthorized: process.env.KUBERNETES_SKIP_TLS_VERIFY !== 'true',
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 5000,
    maxResponseBytes:
      Number.isFinite(maxResponseBytes) && maxResponseBytes > 0
        ? maxResponseBytes
        : 5 * 1024 * 1024,
  };
}

function asTransportError(error: Error): KubernetesTransportError {
  return error instanceof KubernetesTransportError
    ? error
    : new KubernetesTransportError('Kubernetes API transport failed', {
        cause: error,
      });
}

function parseResponse(value: string): unknown {
  if (value.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
