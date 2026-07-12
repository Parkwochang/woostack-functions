import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

interface RequestWithHeaders {
  headers: {
    authorization?: string;
  };
}

@Injectable()
export class ManagementAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.FUNCTION_API_TOKEN;

    if (expected === undefined || expected.length === 0) {
      if (
        process.env.NODE_ENV !== 'production' &&
        process.env.FUNCTION_ALLOW_INSECURE_LOCAL === 'true'
      ) {
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
