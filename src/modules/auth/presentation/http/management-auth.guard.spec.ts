import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Environment } from '../../../../shared/config/environment';
import { ManagementAuthGuard } from './management-auth.guard';

describe('ManagementAuthGuard', () => {
  it('allows token-free local development only when explicitly enabled', () => {
    const guard = createGuard({
      NODE_ENV: 'development',
      FUNCTION_ALLOW_INSECURE_LOCAL: true,
    });

    expect(guard.canActivate(context())).toBe(true);
  });

  it('fails closed by default when authentication is not configured', () => {
    const guard = createGuard({
      NODE_ENV: 'development',
      FUNCTION_ALLOW_INSECURE_LOCAL: false,
    });

    expect(() => guard.canActivate(context())).toThrow(
      ServiceUnavailableException,
    );
  });

  it('ignores the insecure-local switch in production', () => {
    const guard = createGuard({
      NODE_ENV: 'production',
      FUNCTION_ALLOW_INSECURE_LOCAL: true,
    });

    expect(() => guard.canActivate(context())).toThrow(
      ServiceUnavailableException,
    );
  });

  it('accepts the configured bearer token', () => {
    const guard = createGuard({
      FUNCTION_API_TOKEN: 'a-secure-bootstrap-token',
    });

    expect(guard.canActivate(context('Bearer a-secure-bootstrap-token'))).toBe(
      true,
    );
  });

  it('rejects a different bearer token', () => {
    const guard = createGuard({
      FUNCTION_API_TOKEN: 'a-secure-bootstrap-token',
    });

    expect(() =>
      guard.canActivate(context('Bearer a-wrong-bootstrap-token')),
    ).toThrow(UnauthorizedException);
  });
});

function createGuard(values: Partial<Environment>): ManagementAuthGuard {
  const config = {
    get: (name: keyof Environment) => values[name],
  } as ConfigService<Environment, true>;
  return new ManagementAuthGuard(config);
}

function context(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as unknown as ExecutionContext;
}
