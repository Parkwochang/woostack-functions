import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { Environment } from '../../../../shared/config/environment';

interface RequestWithHeaders {
  headers: {
    authorization?: string;
  };
}

@Injectable()
export class ManagementAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get('FUNCTION_API_TOKEN', { infer: true });
    const nodeEnvironment = this.config.get('NODE_ENV', { infer: true });
    const allowInsecureLocal = this.config.get(
      'FUNCTION_ALLOW_INSECURE_LOCAL',
      { infer: true },
    );

    if (expected === undefined || expected.length === 0) {
      if (nodeEnvironment !== 'production' && allowInsecureLocal) {
        return true;
      }

      throw new ServiceUnavailableException(
        'management API authentication is not configured',
      );
    }

    const request = context.switchToHttp().getRequest<RequestWithHeaders>();
    const authorization = request.headers.authorization;
    const prefix = 'Bearer ';

    if (authorization === undefined || !authorization.startsWith(prefix)) {
      throw new UnauthorizedException('bearer token is required');
    }

    const actual = Buffer.from(authorization.slice(prefix.length));
    const expectedBuffer = Buffer.from(expected);
    if (
      actual.length !== expectedBuffer.length ||
      !timingSafeEqual(actual, expectedBuffer)
    ) {
      throw new UnauthorizedException('bearer token is invalid');
    }

    return true;
  }
}
