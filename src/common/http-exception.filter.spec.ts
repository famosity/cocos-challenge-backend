import { Logger, type ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter.js';

describe('HttpExceptionFilter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the request id from the header when the request has no context', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, sent } = hostWith('from-header');

    new HttpExceptionFilter().catch('fallo', host);

    expect(sent.body).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Error interno',
      requestId: 'from-header',
    });
  });

  it('uses an empty request id when the header is not text', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, sent } = hostWith(['not-a-string']);

    new HttpExceptionFilter().catch('fallo', host);

    expect(sent.body).toMatchObject({ requestId: '' });
  });
});

function hostWith(header: unknown): { host: ArgumentsHost; sent: { body?: unknown } } {
  const sent: { body?: unknown } = {};
  const response = {
    getHeader: () => header,
    status() {
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as ArgumentsHost;
  return { host, sent };
}
