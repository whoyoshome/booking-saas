import { Controller, Get } from '@nestjs/common';

/**
 * Liveness check: reports whether the Node process is up. It deliberately
 * does not check Postgres or Redis.
 */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
    };
  }
}
