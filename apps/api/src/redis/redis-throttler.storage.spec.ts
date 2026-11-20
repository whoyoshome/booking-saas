import { RedisService } from './redis.service';
import { RedisThrottlerStorage, throttlerStorageFromEnv } from './redis-throttler.storage';

function redisReturning(impl: RedisService['incrementWindow']) {
  return { incrementWindow: jest.fn(impl) } as unknown as RedisService & {
    incrementWindow: jest.Mock;
  };
}

describe('RedisThrottlerStorage', () => {
  it('counts in Redis under a prefixed key and reports seconds to expiry', async () => {
    const redis = redisReturning(async () => ({ hits: 3, msToExpire: 41_200 }));
    const storage = new RedisThrottlerStorage(redis);

    await expect(storage.increment('abc', 60_000)).resolves.toEqual({ totalHits: 3, timeToExpire: 42 });
    expect(redis.incrementWindow).toHaveBeenCalledWith('throttle:abc', 60_000);
  });

  it('falls back to an in-memory counter when Redis fails, and still limits', async () => {
    const redis = redisReturning(async () => {
      throw new Error('Redis operation budget exceeded');
    });
    const storage = new RedisThrottlerStorage(redis);

    const hits = [];
    for (let i = 0; i < 3; i++) {
      // eslint-disable-next-line no-await-in-loop
      hits.push((await storage.increment('abc', 60_000)).totalHits);
    }
    expect(hits).toEqual([1, 2, 3]);
  });

  it('goes back to Redis as soon as it answers again', async () => {
    let up = false;
    const redis = redisReturning(async () => {
      if (!up) throw new Error('connection refused');
      return { hits: 7, msToExpire: 1_000 };
    });
    const storage = new RedisThrottlerStorage(redis);

    expect((await storage.increment('abc', 60_000)).totalHits).toBe(1); // fallback
    up = true;
    expect((await storage.increment('abc', 60_000)).totalHits).toBe(7); // Redis
  });
});

describe('throttlerStorageFromEnv', () => {
  const redis = {} as RedisService;

  it.each([undefined, '', 'memory', ' Memory '])('%p keeps the default in-memory storage', (value) => {
    expect(throttlerStorageFromEnv(value, redis)).toBeUndefined();
  });

  it.each(['redis', 'REDIS'])('%p selects Redis', (value) => {
    expect(throttlerStorageFromEnv(value, redis)).toBeInstanceOf(RedisThrottlerStorage);
  });

  it('rejects anything else at startup', () => {
    expect(() => throttlerStorageFromEnv('upstash', redis)).toThrow(/THROTTLE_STORAGE must be/);
  });
});
