var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var HttpExceptionFilter_1;
import { Catch, Logger } from '@nestjs/common';
import { currentRequestId } from './request-context.js';
import { toErrorBody } from './http-error.js';
let HttpExceptionFilter = HttpExceptionFilter_1 = class HttpExceptionFilter {
    logger = new Logger(HttpExceptionFilter_1.name);
    catch(exception, host) {
        const response = host.switchToHttp().getResponse();
        const requestId = currentRequestId() ?? headerOf(response);
        const body = toErrorBody(exception, requestId);
        if (body.statusCode >= 500) {
            this.logger.error(JSON.stringify({
                level: 'error',
                requestId,
                message: exception instanceof Error ? exception.message : 'Error interno',
                stack: exception instanceof Error ? exception.stack : undefined,
            }));
        }
        response.status(body.statusCode).json(body);
    }
};
HttpExceptionFilter = HttpExceptionFilter_1 = __decorate([
    Catch()
], HttpExceptionFilter);
export { HttpExceptionFilter };
function headerOf(response) {
    const value = response.getHeader('X-Request-Id');
    return typeof value === 'string' ? value : '';
}
//# sourceMappingURL=http-exception.filter.js.map