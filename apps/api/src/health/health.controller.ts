import { Controller, Get } from '@nestjs/common';

/**
 * Simple health check for Phase 1.
 *
 * Intentionally does NOT validate Postgres/Redis connectivity yet — that
 * comes in Phase 3+ when those modules actually exist, to avoid coupling
 * container startup to dependencies that have no logic yet.
 * This endpoint answers "is the Node process alive?", which is all Phase 1
 * needs to guarantee.
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
