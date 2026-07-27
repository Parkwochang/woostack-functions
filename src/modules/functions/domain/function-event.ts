import { FunctionState, FunctionView } from './function-runtime.port';

interface FunctionEventBase {
  eventId: string;
  occurredAt: string;
  name: string;
  namespace: string;
}

export interface FunctionAppliedEvent extends FunctionEventBase {
  type: 'function.applied';
  function: FunctionView;
}

export interface FunctionDeletedEvent extends FunctionEventBase {
  type: 'function.deleted';
}

export interface FunctionStateChangedEvent extends FunctionEventBase {
  type: 'function.state.changed' | 'function.ready' | 'function.failed';
  previousState: FunctionState;
  currentState: FunctionState;
  function: FunctionView;
}

export type FunctionEvent =
  FunctionAppliedEvent | FunctionDeletedEvent | FunctionStateChangedEvent;

export interface FunctionEventPublisher {
  publish(event: FunctionEvent): void;
}

export const FUNCTION_EVENT_PUBLISHER = Symbol('FUNCTION_EVENT_PUBLISHER');
