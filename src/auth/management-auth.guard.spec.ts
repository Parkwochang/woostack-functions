import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ManagementAuthGuard } from './management-auth.guard';

describe('ManagementAuthGuard', () => {
  const guard = new ManagementAuthGuard();
  const originalNodeEnv = process.env.NODE_ENV;
  const originalToken = process.env.FUNCTION_API_TOKEN;
  const originalInsecureLocal = process.env.FUNCTION_ALLOW_INSECURE_LOCAL;

  afterEach(() => {
    restore('NODE_ENV', originalNodeEnv);
    restore('FUNCTION_API_TOKEN', originalToken);
    restore('FUNCTION_ALLOW_INSECURE_LOCAL', originalInsecureLocal);
  });

  it('allows token-free local development only when explicitly enabled', () => {
    delete process.env.NODE_ENV;
    delete process.env.FUNCTION_API_TOKEN;
    process.env.FUNCTION_ALLOW_INSECURE_LOCAL = 'true';

    expect(guard.canActivate(context())).toBe(true);
  });

  it('fails closed by default when authentication is not configured', () => {
    delete process.env.NODE_ENV;
    delete process.env.FUNCTION_API_TOKEN;
    delete process.env.FUNCTION_ALLOW_INSECURE_LOCAL;

    expect(() => guard.canActivate(context())).toThrow(
      ServiceUnavailableException,
    );
  });

  it('ignores the insecure-local switch in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.FUNCTION_API_TOKEN;
    process.env.FUNCTION_ALLOW_INSECURE_LOCAL = 'true';

    expect(() => guard.canActivate(context())).toThrow(
      ServiceUnavailableException,
    );
  });

  it('accepts the configured bearer token', () => {
    process.env.FUNCTION_API_TOKEN = 'a-secure-bootstrap-token';

    expect(guard.canActivate(context('Bearer a-secure-bootstrap-token'))).toBe(
      true,
    );
  });

  it('rejects a different bearer token', () => {
    process.env.FUNCTION_API_TOKEN = 'a-secure-bootstrap-token';

    expect(() =>
      guard.canActivate(context('Bearer a-wrong-bootstrap-token')),
    ).toThrow(UnauthorizedException);
  });
});

function context(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as unknown as ExecutionContext;
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
