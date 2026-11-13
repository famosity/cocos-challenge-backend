import { BadRequestException, HttpException } from '@nestjs/common';
import { AppError } from './app-error.js';
const internalBody = (requestId, statusCode = 500) => ({
    statusCode,
    code: 'INTERNAL_ERROR',
    message: 'Error interno',
    requestId,
});
export function toErrorBody(exception, requestId) {
    if (exception instanceof AppError) {
        return {
            statusCode: exception.statusCode,
            code: exception.code,
            message: exception.message,
            requestId,
            ...(exception.details ? { details: exception.details } : {}),
        };
    }
    if (exception instanceof BadRequestException) {
        return {
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            message: 'La solicitud es inválida',
            requestId,
            details: fieldErrors(messagesOf(exception.getResponse())),
        };
    }
    if (exception instanceof HttpException) {
        const statusCode = exception.getStatus();
        if (statusCode >= 500)
            return internalBody(requestId, statusCode);
        return {
            statusCode,
            code: codeFor(statusCode),
            message: textOf(exception.getResponse()),
            requestId,
        };
    }
    return internalBody(requestId);
}
function messagesOf(response) {
    if (typeof response === 'string')
        return [response];
    if (!('message' in response))
        return ['solicitud inválida'];
    const { message } = response;
    if (Array.isArray(message))
        return message.map(String);
    if (typeof message === 'string')
        return [message];
    return ['solicitud inválida'];
}
function textOf(response) {
    const [first] = messagesOf(response);
    return first ?? 'Error';
}
function fieldErrors(messages) {
    return messages.map((entry) => {
        const splitAt = entry.indexOf(' ');
        const field = splitAt === -1 ? '' : entry.slice(0, splitAt);
        if (!/^[A-Za-z_][\w.]*$/.test(field)) {
            return { field: 'body', message: entry };
        }
        return { field, message: entry.slice(splitAt + 1) };
    });
}
function codeFor(statusCode) {
    if (statusCode === 404)
        return 'NOT_FOUND';
    if (statusCode === 422)
        return 'UNPROCESSABLE';
    return 'HTTP_ERROR';
}
//# sourceMappingURL=http-error.js.map