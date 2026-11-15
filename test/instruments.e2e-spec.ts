import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { loadEnvFile } from '../src/load-env.js';

loadEnvFile();

type Instrument = {
  id: number;
  ticker: string;
  name: string;
  type: string;
};

describe('GET /instruments', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    database = moduleFixture.get(DatabaseService);
    await app.init();
  });

  afterAll(async () => {
    await database.query(`DELETE FROM instruments WHERE ticker IN ('ZZEXACT', 'AAAPART')`);
    await app.close();
  });

  it('finds a ticker without caring about case', async () => {
    const response = await request(app.getHttpServer()).get('/instruments').query({ query: 'ggal' }).expect(200);

    const body = response.body as Instrument[];
    expect(body[0]).toMatchObject({
      ticker: 'GGAL',
      name: 'Grupo Financiero Galicia',
      type: 'ACCIONES',
    });
    expect(typeof body[0]?.id).toBe('number');
  });

  it('finds a partial name', async () => {
    const response = await request(app.getHttpServer()).get('/instruments').query({ query: 'Galicia' }).expect(200);

    const tickers = (response.body as Instrument[]).map((instrument) => instrument.ticker);
    expect(tickers).toContain('GGAL');
  });

  it('puts the exact ticker before a name match that would sort first', async () => {
    await database.query(
      `INSERT INTO instruments (ticker, name, type) VALUES ('AAAPART', 'zzexact in the name', 'ACCIONES'), ('ZZEXACT', 'something else', 'ACCIONES')`,
    );

    const response = await request(app.getHttpServer()).get('/instruments').query({ query: 'zzexact' }).expect(200);

    expect((response.body as Instrument[]).map((instrument) => instrument.ticker)).toEqual(['ZZEXACT', 'AAAPART']);
  });

  it('returns an empty list when nothing matches', async () => {
    const response = await request(app.getHttpServer())
      .get('/instruments')
      .query({ query: 'no-such-asset' })
      .expect(200);

    expect(response.body).toEqual([]);
  });

  it('treats % and _ as literal characters', async () => {
    const percent = await request(app.getHttpServer()).get('/instruments').query({ query: '%' }).expect(200);
    const underscore = await request(app.getHttpServer()).get('/instruments').query({ query: '_' }).expect(200);

    expect(percent.body).toEqual([]);
    expect(underscore.body).toEqual([]);
  });

  it('rejects a missing query', async () => {
    const response = await request(app.getHttpServer()).get('/instruments').expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      details: [{ field: 'query', message: 'must not be empty' }],
    });
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('rejects a repeated query', async () => {
    const response = await request(app.getHttpServer())
      .get('/instruments')
      .query({ query: ['DYCA', 'CAPX'] })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      details: [{ field: 'query', message: 'must be a single text' }],
    });
  });

  it('rejects a query that is only spaces', async () => {
    const response = await request(app.getHttpServer()).get('/instruments').query({ query: '   ' }).expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });
});
