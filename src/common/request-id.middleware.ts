import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { REQUEST_ID_HEADER, requestContext } from './request-context.js';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestIdMiddleware.name);

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = randomUUID();
    const started = Date.now();
    res.setHeader(REQUEST_ID_HEADER, requestId);
    res.on('finish', () => {
      this.logger.log(
        JSON.stringify({
          level: 'info',
          requestId,
          method: req.method,
          path: req.originalUrl.split('?')[0],
          statusCode: res.statusCode,
          durationMs: Date.now() - started,
        }),
      );
    });
    requestContext.run({ requestId }, () => {
      next();
    });
  }
}
