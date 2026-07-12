import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    process.env.FUNCTION_API_TOKEN = 'e2e-test-token';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    delete process.env.FUNCTION_API_TOKEN;
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          name: 'woostack-functions',
          api: '/v1/functions',
        });
      });
  });

  it('/v1/functions/:name/render (POST)', () => {
    return request(app.getHttpServer())
      .post('/v1/functions/hello/render')
      .set('authorization', 'Bearer e2e-test-token')
      .send({ image: 'harbor.woostack.dev/functions/hello:202607120001' })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          apiVersion: 'serving.knative.dev/v1',
          kind: 'Service',
          metadata: {
            name: 'hello',
            namespace: 'functions',
          },
        });
      });
  });
});
