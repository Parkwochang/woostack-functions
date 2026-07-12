import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getInfo() {
    return {
      name: 'woostack-functions',
      description: 'Kubernetes-native function control plane',
      version: '0.0.1',
      api: '/v1/functions',
      health: '/healthz',
      readiness: '/readyz',
    };
  }
}
