import { BadRequestException, HttpException } from '@nestjs/common';
import { AppError } from './app-error.js';
import { toErrorBody } from '../common/http-error.js';

class TextBadRequest extends BadRequestException {
  override getResponse(): string {
    return 'amount must be a positive number';
  }
}

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

  it('keeps field details attached to an application error', () => {
    const body = toErrorBody(
      new AppError(400, 'VALIDATION_ERROR', 'La solicitud es inválida', [
        { field: 'amount', message: 'must be a positive number' },
      ]),
      requestId,
    );

    expect(body.details).toEqual([{ field: 'amount', message: 'must be a positive number' }]);
  });

  it('reads a validation message that arrives as text', () => {
    const body = toErrorBody(new TextBadRequest(), requestId);

    expect(body.details).toEqual([{ field: 'amount', message: 'must be a positive number' }]);
  });

  it('reads a validation message stored as a string', () => {
    const body = toErrorBody(new BadRequestException('query must not be empty'), requestId);

    expect(body.details).toEqual([{ field: 'query', message: 'must not be empty' }]);
  });

  it('uses a generic detail when the payload has no message', () => {
    const body = toErrorBody(new BadRequestException({ error: 'Bad Request' }), requestId);

    expect(body.details).toEqual([{ field: 'solicitud', message: 'inválida' }]);
  });

  it('uses a generic detail when the message is not text', () => {
    const body = toErrorBody(new BadRequestException({ message: { nested: true } }), requestId);

    expect(body.details).toEqual([{ field: 'solicitud', message: 'inválida' }]);
  });

  it('keeps the whole entry when it does not name a field', () => {
    const withoutSpace = toErrorBody(new BadRequestException(['nospace']), requestId);
    const invalidField = toErrorBody(new BadRequestException(['123 is not a field']), requestId);

    expect(withoutSpace.details).toEqual([{ field: 'body', message: 'nospace' }]);
    expect(invalidField.details).toEqual([{ field: 'body', message: '123 is not a field' }]);
  });

  it('maps http statuses that are not validation errors', () => {
    expect(toErrorBody(new HttpException('El recurso no existe', 404), requestId)).toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'El recurso no existe',
    });
    expect(toErrorBody(new HttpException('No se puede procesar', 422), requestId).code).toBe('UNPROCESSABLE');
    expect(toErrorBody(new HttpException('Conflicto', 409), requestId).code).toBe('HTTP_ERROR');
  });

  it('hides the text of an http 500', () => {
    const body = toErrorBody(new HttpException('db password', 503), requestId);

    expect(body).toEqual({
      statusCode: 503,
      code: 'INTERNAL_ERROR',
      message: 'Error interno',
      requestId,
    });
    expect(JSON.stringify(body)).not.toContain('password');
  });

  it('uses a generic message when an http error brings no text', () => {
    const body = toErrorBody(new HttpException({ message: [] }, 404), requestId);

    expect(body.message).toBe('Error');
    expect(body.code).toBe('NOT_FOUND');
  });
});
