import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { clear } from './utils/setup';
import Redis from 'ioredis';
import {
  DEFAULT_REDIS_NAMESPACE,
  getRedisToken,
} from '@liaoliaots/nestjs-redis';
import { createUser } from './utils/create-user';
import { login } from './utils/login';
import request from 'supertest';

describe('Auth E2E test', () => {
  let app: INestApplication;
  let redis: Redis;
  let id = '';
  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();

    redis = app.get(getRedisToken(DEFAULT_REDIS_NAMESPACE));
    await clear('sqlite');
    await app.init();
    expect(redis).toBeDefined();
    const u = await createUser(app, redis, 'test@no-reply.com', 'test');
    id = u.id.toString();
  });
  afterEach(async () => {
    await redis.flushall();
  });
  it('Create User Account Success', async () => {
    await createUser(app, redis, 'test2@no-reply.com', 'test');
  });
  describe('GetAccountInfo', () => {
    it('success', async () => {
      const { access_token } = await login(
        'admin@no-reply.com',
        'admin',
        process.env.CLIENT_ID,
        app,
      );
      const { status } = await request(app.getHttpServer())
        .get(`/account/${id}`)
        .auth(access_token, { type: 'bearer' });
      expect(status).toBe(HttpStatus.OK);
    });
    it('fail not found', async () => {
      const { access_token } = await login(
        'admin@no-reply.com',
        'admin',
        process.env.CLIENT_ID,
        app,
      );
      const { status } = await request(app.getHttpServer())
        .get(`/account/123654789`)
        .auth(access_token, { type: 'bearer' });
      expect(status).toBe(HttpStatus.NOT_FOUND);
    });
    it('should fail,param invalid, except bigint but found string', async () => {
      const { access_token } = await login(
        'admin@no-reply.com',
        'admin',
        process.env.CLIENT_ID,
        app,
      );
      const { status } = await request(app.getHttpServer())
        .get(`/account/abc`)
        .auth(access_token, { type: 'bearer' });
      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });
  });
  describe('Remove Account', () => {
    it('Success', async () => {
      const { access_token } = await login(
        'admin@no-reply.com',
        'admin',
        process.env.CLIENT_ID,
        app,
      );
      const { status } = await request(app.getHttpServer())
        .del(`/account/${id}`)
        .auth(access_token, { type: 'bearer' });
      expect(status).toBe(HttpStatus.OK);
    });
  });
  describe('Online', () => {
    it('success', async () => {
      await login('test@no-reply.com', 'test', process.env.CLIENT_ID, app);
      const { status, body } = await request(app.getHttpServer())
        .get(`/account/online/${id}`)
        .query({
          clientId: process.env.CLIENT_ID,
          clientSecret: process.env.CLIENT_SECRET,
        });
      expect(status).toBe(HttpStatus.OK);
      expect(body.online).toBe(true);
    });
    it('bad request', async () => {
      await login('test@no-reply.com', 'test', process.env.CLIENT_ID, app);
      const { status } = await request(app.getHttpServer())
        .get(`/account/online/${id}`)
        .query({
          clientId: process.env.CLIENT_ID,
        });
      expect(status).toBe(HttpStatus.BAD_REQUEST);
    });
    it('client not found', async () => {
      await login('test@no-reply.com', 'test', process.env.CLIENT_ID, app);
      const { status } = await request(app.getHttpServer())
        .get(`/account/online/${id}`)
        .query({
          clientId: process.env.CLIENT_ID,
          clientSecret: 'wrong',
        });
      expect(status).toBe(HttpStatus.NOT_FOUND);
    });
    it('user not found', async () => {
      await login('test@no-reply.com', 'test', process.env.CLIENT_ID, app);
      const { status } = await request(app.getHttpServer())
        .get(`/account/online/123465`)
        .query({
          clientId: process.env.CLIENT_ID,
          clientSecret: process.env.CLIENT_SECRET,
        });
      expect(status).toBe(HttpStatus.NOT_FOUND);
    });
  });
});
