import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { InstrumentsRepository } from '../src/instruments/instruments.repository.js';
import { useTestDatabase } from './use-test-database.js';

useTestDatabase();

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

    const body = response.body.items as Instrument[];
    expect(body[0]).toMatchObject({
      ticker: 'GGAL',
      name: 'Grupo Financiero Galicia',
      type: 'ACCIONES',
    });
    expect(typeof body[0]?.id).toBe('number');
  });

  it('finds a partial name', async () => {
    const response = await request(app.getHttpServer()).get('/instruments').query({ query: 'Galicia' }).expect(200);

    const tickers = (response.body.items as Instrument[]).map((instrument) => instrument.ticker);
    expect(tickers).toContain('GGAL');
  });

  it('puts the exact ticker before a name match that would sort first', async () => {
    await database.query(
      `INSERT INTO instruments (ticker, name, type) VALUES ('AAAPART', 'zzexact in the name', 'ACCIONES'), ('ZZEXACT', 'something else', 'ACCIONES')`,
    );

    const response = await request(app.getHttpServer()).get('/instruments').query({ query: 'zzexact' }).expect(200);

    expect((response.body.items as Instrument[]).map((instrument) => instrument.ticker)).toEqual(['ZZEXACT', 'AAAPART']);

    const server = app.getHttpServer();
    const first = await request(server).get('/instruments?query=zzexact&pageSize=1').expect(200);
    expect(first.body.items).toEqual([expect.objectContaining({ ticker: 'ZZEXACT' })]);
    expect(first.body.pagination).toEqual({ page: 1, pageSize: 1, totalItems: 2, totalPages: 2 });

    const second = await request(server).get('/instruments?query=zzexact&page=2&pageSize=1').expect(200);
    expect(second.body.items).toEqual([expect.objectContaining({ ticker: 'AAAPART' })]);
    expect(second.body.pagination).toEqual({ page: 2, pageSize: 1, totalItems: 2, totalPages: 2 });

    const beyond = await request(server).get('/instruments?query=zzexact&page=3&pageSize=1').expect(200);
    expect(beyond.body).toEqual({
      items: [],
      pagination: { page: 3, pageSize: 1, totalItems: 2, totalPages: 2 },
    });
  });

  it('does not list the cash instrument', async () => {
    const byTicker = await request(app.getHttpServer()).get('/instruments').query({ query: 'ARS' }).expect(200);
    const byName = await request(app.getHttpServer()).get('/instruments').query({ query: 'PESOS' }).expect(200);

    expect(byTicker.body.items).toEqual([]);
    expect(byName.body.items).toEqual([]);
  });

  it('returns an empty list when nothing matches', async () => {
    const response = await request(app.getHttpServer())
      .get('/instruments')
      .query({ query: 'no-such-asset' })
      .expect(200);

    expect(response.body).toEqual({
      items: [],
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    });
  });

  it('treats % and _ as literal characters', async () => {
    const percent = await request(app.getHttpServer()).get('/instruments').query({ query: '%' }).expect(200);
    const underscore = await request(app.getHttpServer()).get('/instruments').query({ query: '_' }).expect(200);

    expect(percent.body.items).toEqual([]);
    expect(underscore.body.items).toEqual([]);
  });

  it('rejects an explicitly empty query', async () => {
    const response = await request(app.getHttpServer()).get('/instruments?query=').expect(400);

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

  it('rejects a query that contains a null character', async () => {
    const response = await request(app.getHttpServer()).get('/instruments?query=GG%00AL').expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      details: [{ field: 'query', message: 'must not contain a null character' }],
    });
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it.each([
    [{}, 1, 20],
    [{ page: 3 }, 3, 20],
    [{ pageSize: 10 }, 1, 10],
    [{ page: 3, pageSize: 10 }, 3, 10],
  ] as const)('lists a page with parameters %j', async (query, page, pageSize) => {
    const response = await request(app.getHttpServer()).get('/instruments').query(query).expect(200);

    expect(response.body.pagination).toMatchObject({ page, pageSize });
    expect(response.body.items).toHaveLength(pageSize);
  });

  it('lists a stable catalog without cash instruments and reports the totals on an empty page', async () => {
    const server = app.getHttpServer();
    const catalog = await request(server).get('/instruments?pageSize=100').expect(200);
    const items = catalog.body.items as Instrument[];
    expect(items).not.toContainEqual(expect.objectContaining({ type: 'MONEDA' }));
    expect(items).not.toContainEqual(expect.objectContaining({ ticker: 'ARS' }));
    expect(catalog.body.pagination).toEqual({ page: 1, pageSize: 100, totalItems: items.length, totalPages: 1 });

    const second = await request(server).get('/instruments?page=2&pageSize=10').expect(200);
    expect(second.body.items).toEqual(items.slice(10, 20));
    expect(second.body.pagination).toEqual({
      page: 2,
      pageSize: 10,
      totalItems: items.length,
      totalPages: Math.ceil(items.length / 10),
    });

    const lastPage = Math.ceil(items.length / 20);
    const last = await request(server).get(`/instruments?page=${lastPage}`).expect(200);
    expect(last.body.items).toEqual(items.slice((lastPage - 1) * 20));
    const beyond = await request(server).get(`/instruments?page=${lastPage + 1}`).expect(200);
    expect(beyond.body).toEqual({
      items: [],
      pagination: { page: lastPage + 1, pageSize: 20, totalItems: items.length, totalPages: lastPage },
    });
  });

  it('returns zero total pages for an empty catalog', async () => {
    const repository = app.get(InstrumentsRepository);
    const list = vi.spyOn(repository, 'list').mockResolvedValueOnce({ items: [], totalItems: '0' });
    try {
      const response = await request(app.getHttpServer()).get('/instruments').expect(200);
      expect(response.body).toEqual({
        items: [],
        pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
      });
    } finally {
      list.mockRestore();
    }
  });

  it.each([
    ['page=', 'page'],
    ['page=0', 'page'],
    ['page=-1', 'page'],
    ['page=1.5', 'page'],
    ['page=abc', 'page'],
    ['page=9007199254740992', 'page'],
    ['page=1&page=2', 'page'],
    ['pageSize=', 'pageSize'],
    ['pageSize=0', 'pageSize'],
    ['pageSize=101', 'pageSize'],
    ['pageSize=10&pageSize=20', 'pageSize'],
  ])('rejects invalid pagination %s', async (query, field) => {
    const response = await request(app.getHttpServer()).get(`/instruments?${query}`).expect(400);
    expect(response.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [expect.objectContaining({ field })],
    });
  });

  it('rejects a query that is only spaces', async () => {
    const response = await request(app.getHttpServer()).get('/instruments').query({ query: '   ' }).expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });
});
