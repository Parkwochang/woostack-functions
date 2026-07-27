import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  FunctionEvent,
  FunctionEventPublisher,
} from '../../domain/function-event';

@Injectable()
export class NestFunctionEventPublisher implements FunctionEventPublisher {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  publish(event: FunctionEvent): void {
    this.eventEmitter.emit(event.type, event);
  }
}
