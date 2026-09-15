import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

const OPERATION_BUDGET_MS = 300;

/**
 * Thin wrapper, not a generic cache abstraction — cache-aside is applied
 * explicitly at each call site (AvailabilityService/BookingsService), not
 * hidden behind a decorator. Given there's exactly one thing cached right
 * now (staff bookings per day), a generic caching layer would be
 * abstraction ahead of a second real use case.
 *
 * FIX (verified against a real Redis outage) — ioredis's default
 * `enableOfflineQueue: true` queues commands indefinitely while
 * disconnected instead of failing fast, and its default connect timeout
 * (~10s) is longer than TenantContextInterceptor's own Prisma transaction
 * timeout. The combination meant a Redis outage didn't degrade to
 * cache-miss as intended — it hung the get/set call long enough for the
 * SURROUNDING Prisma transaction to time out first, turning "Redis is
 * down" into a 500 from Postgres, exactly the failure mode this class's
 * try/catch was supposed to prevent. Fixed with `enableOfflineQueue:
 * false` + a short `connectTimeout`, AND a `Promise.race` budget on every
 * operation here — belt and suspenders, since ioredis's own timeout
 * options don't cover every failure path (e.g. a connection that's
 * technically open but not responding).
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  onModuleInit(): void {
    this.client = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379', {
      enableOfflineQueue: false,
      connectTimeout: 300,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    this.client.on('error', (err) => {
      this.logger.warn(`Redis connection error (degrading to no-cache): ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => {});
  }

  async getJson<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.withBudget(this.client.get(key));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      // Redis unreachable, slow, or bad data — treat exactly like a
      // cache miss. Availability must never fail because the cache is
      // unhealthy or slow.
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.withBudget(this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds));
    } catch {
      // Best-effort — a failed/slow cache write is not a request failure.
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.withBudget(this.client.del(key));
    } catch {
      // If this fails, the TTL is still the safety net — a stale
      // availability read for a few seconds is an acceptable cost, a
      // hard failure on cancel/confirm is not.
    }
  }

  /**
   * Caps how long ANY Redis operation is allowed to block the caller.
   * This exists on top of ioredis's own connectTimeout/retryStrategy
   * because those cover connection setup, not every way a command can
   * stall once "connected" — and callers here (AvailabilityService,
   * BookingsService) run inside TenantContextInterceptor's Prisma
   * transaction, which has its own timeout. A slow Redis must lose that
   * race deterministically, every time.
   */
  private withBudget<T>(promise: Promise<T>): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Redis operation budget exceeded')), OPERATION_BUDGET_MS),
      ),
    ]);
  }
}
