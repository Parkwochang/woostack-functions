import { Controller, Get } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';
import { FunctionsApplicationService } from './modules/functions/application/functions.application-service';

@ApiTags('platform')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly functionsService: FunctionsApplicationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get platform metadata' })
  getInfo() {
    return this.appService.getInfo();
  }

  @Get('healthz')
  @ApiExcludeEndpoint()
  getHealth() {
    return { status: 'ok' };
  }

  @Get('readyz')
  @ApiExcludeEndpoint()
  async getReadiness() {
    await this.functionsService.checkRuntime();

    return {
      status: 'ready',
      runtime: 'knative-serving',
    };
  }
}
