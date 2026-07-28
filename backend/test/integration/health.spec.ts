import { RequestMethod, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { RedisService } from '../../src/common/redis/redis.service.js';

describe('health endpoints with real dependencies', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('v1', {
      exclude: [
        { method: RequestMethod.ALL, path: 'healthz' },
        { method: RequestMethod.ALL, path: 'readyz' },
      ],
    });
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports live and propagates a supplied correlation ID', async () => {
    const correlationId = '9ed9f4bf-f822-4f75-9e3d-b5b541261d22';
    const response = await request(server)
      .get('/healthz')
      .set('X-Correlation-Id', correlationId)
      .expect(200);

    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-correlation-id']).toBe(correlationId);
  });

  it('replaces an invalid correlation ID', async () => {
    const response = await request(server)
      .get('/healthz')
      .set('X-Correlation-Id', 'unsafe-value')
      .expect(200);

    expect(response.headers['x-correlation-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('reports ready while PostgreSQL and Redis are healthy', async () => {
    const response = await request(server).get('/readyz');

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({
      deps: {
        db: { status: 'up' },
        redis: { status: 'up' },
      },
      state: 'ready',
      status: 'ok',
    });
  });

  it('stays live but fails readiness after Redis disconnects', async () => {
    app.get(RedisService).connection.disconnect();

    await request(server).get('/healthz').expect(200);
    const response = await request(server).get('/readyz').expect(503);
    expect(response.body).toMatchObject({
      deps: { redis: { status: 'down' } },
      status: 'unavailable',
    });
  });
});
