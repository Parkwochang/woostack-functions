import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import {
  FunctionRuntimeError,
  FunctionValidationError,
  UnmanagedFunctionError,
} from '../../domain/function.errors';

interface HttpResponse {
  status(code: number): HttpResponse;
  json(body: unknown): void;
}

@Catch(FunctionValidationError, UnmanagedFunctionError, FunctionRuntimeError)
export class FunctionsExceptionFilter implements ExceptionFilter {
  catch(
    exception:
      FunctionValidationError | UnmanagedFunctionError | FunctionRuntimeError,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    const status = statusFor(exception);
    const message =
      exception instanceof FunctionRuntimeError &&
      exception.detail !== undefined
        ? `${exception.message}: ${exception.detail}`
        : exception.message;

    response.status(status).json({
      statusCode: status,
      message,
      error: errorName(status),
    });
  }
}

function statusFor(
  exception:
    FunctionValidationError | UnmanagedFunctionError | FunctionRuntimeError,
): number {
  if (exception instanceof FunctionValidationError) {
    return HttpStatus.BAD_REQUEST;
  }
  if (exception instanceof UnmanagedFunctionError) {
    return HttpStatus.CONFLICT;
  }

  switch (exception.code) {
    case 'not-found':
      return HttpStatus.NOT_FOUND;
    case 'rejected':
      return HttpStatus.BAD_REQUEST;
    case 'conflict':
      return HttpStatus.CONFLICT;
    case 'forbidden':
      return HttpStatus.FORBIDDEN;
    case 'rate-limited':
      return HttpStatus.TOO_MANY_REQUESTS;
    case 'unavailable':
      return HttpStatus.SERVICE_UNAVAILABLE;
    case 'upstream':
      return HttpStatus.BAD_GATEWAY;
  }
}

function errorName(status: number): string {
  return HttpStatus[status]
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
