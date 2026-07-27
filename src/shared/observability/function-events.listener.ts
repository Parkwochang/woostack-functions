import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { FunctionEvent } from '../../modules/functions/domain/function-event';
import { MetricsService } from './metrics.service';

@Injectable()
export class FunctionEventsListener {
  private readonly logger = new Logger(FunctionEventsListener.name);

  constructor(private readonly metrics: MetricsService) {}

  @OnEvent('function.**', { suppressErrors: true })
  handle(event: FunctionEvent): void {
    this.metrics.recordFunctionEvent(event.type);
    this.logger.log(
      {
        eventId: event.eventId,
        type: event.type,
        functionName: event.name,
        namespace: event.namespace,
      },
      'Function lifecycle event',
    );
  }
}
