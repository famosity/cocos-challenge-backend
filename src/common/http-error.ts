import { BadRequestException, HttpException } from '@nestjs/common';
import { AppError, type FieldError } from './app-error.js';

export type ErrorBody = {
  statusCode: number;
  code: string;
  message: string;
  requestId: string;
  details?: FieldError[];
};

const internalBody = (requestId: string, statusCode = 500): ErrorBody => ({
  statusCode,
  code: 'INTERNAL_ERROR',
  message: 'Error interno',
  requestId,
});

export function toErrorBody(exception: unknown, requestId: string): ErrorBody {
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
    if (statusCode >= 500) return internalBody(requestId, statusCode);
    return {
      statusCode,
      code: codeFor(statusCode),
      message: textOf(exception.getResponse()),
      requestId,
    };
  }

  return internalBody(requestId);
}

function messagesOf(response: string | object): string[] {
  if (typeof response === 'string') return [response];
  if (!('message' in response)) return ['solicitud inválida'];
  const { message } = response;
  if (Array.isArray(message)) return message.map(String);
  if (typeof message === 'string') return [message];
  return ['solicitud inválida'];
}

function textOf(response: string | object): string {
  const [first] = messagesOf(response);
  return first ?? 'Error';
}

function fieldErrors(messages: string[]): FieldError[] {
  return messages.map((entry) => {
    const splitAt = entry.indexOf(' ');
    const field = splitAt === -1 ? '' : entry.slice(0, splitAt);
    if (!/^[A-Za-z_][\w.]*$/.test(field)) {
      return { field: 'body', message: entry };
    }
    return { field, message: entry.slice(splitAt + 1) };
  });
}

function codeFor(statusCode: number): string {
  if (statusCode === 404) return 'NOT_FOUND';
  if (statusCode === 422) return 'UNPROCESSABLE';
  return 'HTTP_ERROR';
}
