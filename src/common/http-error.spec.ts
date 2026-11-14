import { BadRequestException } from '@nestjs/common';
import { AppError } from './app-error.js';
import { toErrorBody } from '../common/http-error.js';

const requestId = 'req-1';

describe('toErrorBody', () => {
  it('hides an unexpected failure behind a generic 500', () => {
    const body = toErrorBody(new Error('password=secret'), requestId);

    expect(body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Error interno',
      requestId,
    });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('keeps a known application error and its code', () => {
    const body = toErrorBody(
      new AppError(404, 'USER_NOT_FOUND', 'El usuario no existe'),
      requestId,
    );

    expect(body).toEqual({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
      message: 'El usuario no existe',
      requestId,
    });
  });

  it('turns a validation failure into field details', () => {
    const body = toErrorBody(
      new BadRequestException(['amount must be a positive number']),
      requestId,
    );

    expect(body).toEqual({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'La solicitud es inválida',
      requestId,
      details: [{ field: 'amount', message: 'must be a positive number' }],
    });
  });

  it('returns 422 codes without inventing a saved order', () => {
    const body = toErrorBody(
      new AppError(422, 'ZERO_ORDER_QUANTITY', 'El monto no alcanza para una acción'),
      requestId,
    );

    expect(body.statusCode).toBe(422);
    expect(body.code).toBe('ZERO_ORDER_QUANTITY');
    expect(body.requestId).toBe(requestId);
  });
});
