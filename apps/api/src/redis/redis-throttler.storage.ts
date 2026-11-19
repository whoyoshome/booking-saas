import { Logger } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { RedisService } from './redis.service';

// Not exported from the package root in @nestjs/throttler 5.x.
type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

const KEY_PREFIX = 'throttle:';

/**
 * Rate-limit counters in Redis, so every API instance shares them (several
 * ECS tasks behind an ALB, or a restart, no longer start from zero).
 *
 * Opt-in with THROTTLE_STORAGE=redis. It costs one Redis round-trip per
 * request, and only matters with more than one instance; local dev and the
 * e2e suite keep the default in-memory counters (with a shared counter,
 * every e2e spec logging in from 127.0.0.1 would share one 5/min budget).
 *
 * Fixed window per key: a client can make up to 2x the limit across a
 * window boundary, the usual trade-off for one atomic INCR.
 *
 * If Redis is unreachable or slow (RedisService's 300 ms budget), it falls
 * back to a per-process in-memory counter instead of failing the request
 * or letting it through unlimited, and switches back once Redis answers.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly fallback = new ThrottlerStorageService();
  private degraded = false;

  constructor(private readonly redis: RedisService) {}

  async increment(key: string, ttl: number): Promise<ThrottlerStorageRecord> {
    try {
      const { hits, msToExpire } = await this.redis.incrementWindow(KEY_PREFIX + key, ttl);
      if (this.degraded) {
        this.degraded = false;
        this.logger.log('Redis is back; rate limits are shared across instances again.');
      }
      // Seconds, like the in-memory storage: ThrottlerGuard puts it in Retry-After.
      return { totalHits: hits, timeToExpire: Math.ceil(msToExpire / 1000) };
    } catch (err) {
      if (!this.degraded) {
        this.degraded = true;
        this.logger.warn(
          `Redis unavailable for rate limiting, using per-instance counters: ${(err as Error).message}`,
        );
      }
      return this.fallback.increment(key, ttl);
    }
  }
}

/**
 * Storage for ThrottlerModule from THROTTLE_STORAGE: unset or "memory" ->
 * undefined (the module's default in-memory storage), "redis" ->
 * RedisThrottlerStorage. Anything else fails at startup.
 */
export function throttlerStorageFromEnv(
  value: string | undefined,
  redis: RedisService,
): ThrottlerStorage | undefined {
  const mode = (value ?? '').trim().toLowerCase();
  if (mode === '' || mode === 'memory') return undefined;
  if (mode === 'redis') return new RedisThrottlerStorage(redis);
  throw new Error(`THROTTLE_STORAGE must be "memory" or "redis", got "${value}".`);
}
