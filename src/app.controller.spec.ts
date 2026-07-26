import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FunctionsApplicationService } from './modules/functions/application/functions.application-service';

describe('AppController', () => {
  let appController: AppController;
  const functionsService = {
    checkRuntime: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: FunctionsApplicationService,
          useValue: functionsService,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('returns platform metadata', () => {
      expect(appController.getInfo()).toMatchObject({
        name: 'woostack-functions',
        api: '/v1/functions',
      });
    });

    it('reports process health', () => {
      expect(appController.getHealth()).toEqual({ status: 'ok' });
    });

    it('checks Knative for readiness', async () => {
      await expect(appController.getReadiness()).resolves.toEqual({
        status: 'ready',
        runtime: 'knative-serving',
      });
      expect(functionsService.checkRuntime).toHaveBeenCalled();
    });
  });
});
