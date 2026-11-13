var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var RequestIdMiddleware_1;
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { requestContext } from './request-context.js';
let RequestIdMiddleware = RequestIdMiddleware_1 = class RequestIdMiddleware {
    logger = new Logger(RequestIdMiddleware_1.name);
    use(req, res, next) {
        const requestId = randomUUID();
        const started = Date.now();
        res.setHeader('X-Request-Id', requestId);
        res.on('finish', () => {
            this.logger.log(JSON.stringify({
                level: 'info',
                requestId,
                method: req.method,
                path: req.originalUrl.split('?')[0] ?? req.originalUrl,
                statusCode: res.statusCode,
                durationMs: Date.now() - started,
            }));
        });
        requestContext.run({ requestId }, () => {
            next();
        });
    }
};
RequestIdMiddleware = RequestIdMiddleware_1 = __decorate([
    Injectable()
], RequestIdMiddleware);
export { RequestIdMiddleware };
//# sourceMappingURL=request-id.middleware.js.map