import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { FunctionsService } from './functions/functions.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly functionsService: FunctionsService,
  ) {}

  @Get()
  getInfo() {
    return this.appService.getInfo();
  }

  @Get('healthz')
  getHealth() {
    return { status: 'ok' };
  }

  @Get('readyz')
  async getReadiness() {
    await this.functionsService.checkRuntime();

    return {
      status: 'ready',
      runtime: 'knative-serving',
    };
  }
}
