import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { FunctionEventsListener } from './function-events.listener';
import { MetricsService } from './metrics.service';

@Module({
  controllers: [MetricsController],
  providers: [MetricsService, FunctionEventsListener],
  exports: [MetricsService],
})
export class ObservabilityModule {}
