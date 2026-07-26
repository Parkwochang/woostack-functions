import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Gauge, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleDestroy {
  private readonly registry = new Registry();

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
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  onModuleDestroy(): void {
    this.registry.clear();
  }
}
