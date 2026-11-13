import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { LoggerService } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';

@Controller('probe')
class ProbeController {
  @Get('ok')
  ok(): { ok: true } {
    return { ok: true };
  }

  @Get('boom')
  boom(): never {
    throw new Error('connection string leaked');
  }
}

class MemoryLogger implements LoggerService {
  readonly lines: string[] = [];

  log(message: unknown): void {
    this.lines.push(String(message));
  }

  error(message: unknown): void {
    this.lines.push(String(message));
  }

  warn(message: unknown): void {
    this.lines.push(String(message));
  }
}

describe('request id', () => {
  let app: INestApplication<App>;
  let logger: MemoryLogger;

  beforeEach(async () => {
    logger = new MemoryLogger();
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useLogger(logger);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('uses the same request id on a successful response and its log', async () => {
    const response = await request(app.getHttpServer()).get('/probe/ok').expect(200);

    const requestId = response.headers['x-request-id'];
    expect(requestId).toEqual(expect.any(String));
    expect(requestId.length).toBeGreaterThan(0);
    expect(loggedLine(logger, requestId)).toMatchObject({
      requestId,
      method: 'GET',
      path: '/probe/ok',
      statusCode: 200,
    });
  });

  it('uses the same request id on an error body, the header and a single technical log', async () => {
    const response = await request(app.getHttpServer()).get('/probe/boom').expect(500);

    const requestId = response.headers['x-request-id'];
    expect(response.body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Error interno',
      requestId,
    });
    expect(JSON.stringify(response.body)).not.toContain('leaked');

    const technical = logger.lines.filter((line) => line.includes(requestId) && line.includes('error'));
    expect(technical).toHaveLength(1);
    expect(technical[0]).toContain('connection string leaked');
  });
});

function loggedLine(logger: MemoryLogger, requestId: string): Record<string, unknown> {
  const line = logger.lines.find((entry) => entry.includes(requestId) && entry.includes('statusCode'));
  expect(line).toBeDefined();
  return JSON.parse(line ?? '') as Record<string, unknown>;
}
