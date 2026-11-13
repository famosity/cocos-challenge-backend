import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { currentRequestId } from './request-context.js';
import { toErrorBody } from './http-error.js';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = currentRequestId() ?? headerOf(response);
    const body = toErrorBody(exception, requestId);

    if (body.statusCode >= 500) {
      this.logger.error(
        JSON.stringify({
          level: 'error',
          requestId,
          message: exception instanceof Error ? exception.message : 'Error interno',
          stack: exception instanceof Error ? exception.stack : undefined,
        }),
      );
    }

    response.status(body.statusCode).json(body);
  }
}

function headerOf(response: Response): string {
  const value = response.getHeader('X-Request-Id');
  return typeof value === 'string' ? value : '';
}
