import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleDestroy {
  private readonly registry = new Registry();
  private readonly functionEvents: Counter<'type'>;

  constructor() {
    this.registry.setDefaultLabels({
      application: 'woostack-functions',
    });
    collectDefaultMetrics({
      register: this.registry,
      prefix: 'woostack_functions_',
    });

    const platformInfo = new Gauge({
      name: 'woostack_functions_platform_info',
      help: 'Static information about the functions control plane',
      labelNames: ['version', 'runtime'],
      registers: [this.registry],
    });
    platformInfo.set({ version: '0.0.1', runtime: 'knative-serving' }, 1);

    this.functionEvents = new Counter({
      name: 'woostack_functions_events_total',
      help: 'Function lifecycle events emitted by the control plane',
      labelNames: ['type'],
      registers: [this.registry],
    });
  }

  recordFunctionEvent(type: string): void {
    this.functionEvents.inc({ type });
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  onModuleDestroy(): void {
    this.registry.clear();
  }
}
