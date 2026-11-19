import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { applyTrustProxy } from '../src/common/config/trust-proxy';
import { RedisService } from '../src/redis/redis.service';
import { futureMonday } from './support/dates';

const MONDAY = futureMonday();

async function bootApp(
  options: { trustProxy?: string; throttleStorage?: string } = {},
): Promise<INestApplication> {
  // ThrottlerModule reads THROTTLE_STORAGE while the module compiles.
  const previousStorage = process.env.THROTTLE_STORAGE;
  if (options.throttleStorage !== undefined) process.env.THROTTLE_STORAGE = options.throttleStorage;
  try {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>();
    // Same call main.ts makes with process.env.TRUST_PROXY.
    applyTrustProxy(app, options.trustProxy);
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    return app;
  } finally {
    if (previousStorage === undefined) delete process.env.THROTTLE_STORAGE;
    else process.env.THROTTLE_STORAGE = previousStorage;
  }
}

/** The Redis client connects asynchronously after init; wait until it answers. */
async function waitForRedis(app: INestApplication): Promise<void> {
  const redis = app.get(RedisService);
  for (let i = 0; i < 50; i++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await redis.incrementWindow('throttle:e2e-warmup', 1_000);
      return;
    } catch {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Redis did not become ready.');
}

describe('Redis cache invalidation (e2e)', () => {
  let app: INestApplication;
  let tenantAToken: string;

  beforeAll(async () => {
    app = await bootApp();
    const loginA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@tenant.dev', password: 'ChangeMe123!', tenantSlug: 'e2e-tenant-a' })
      .expect(200);
    tenantAToken = loginA.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('a booking just created disappears from the NEXT GET /availability, not a stale cached view; cancelling it makes it reappear immediately', async () => {
    const branchRes = await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Sucursal cache e2e' })
      .expect(201);

    const staffRes = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ email: `cache-staff-${Date.now()}@tenant-a.dev`, branchId: branchRes.body.id })
      .expect(201);

    const serviceRes = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        branchId: branchRes.body.id,
        name: 'Servicio cache e2e',
        durationMinutes: 30,
        price: 15000,
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/staff/${staffRes.body.id}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ serviceIds: [serviceRes.body.id] })
      .expect(200);

    await request(app.getHttpServer())
      .post('/staff-schedules')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ staffId: staffRes.body.id, dayOfWeek: 1, startTime: '09:00', endTime: '10:00' })
      .expect(201);

    const availabilityUrl = `/availability?staffId=${staffRes.body.id}&serviceId=${serviceRes.body.id}&date=${MONDAY}`;
    const hasNineAm = (body: { slots: { startLocal: string }[] }) =>
      body.slots.some((s) => s.startLocal === '09:00');

    // First read — populates the Redis cache for (tenant, staff, date).
    const before = await request(app.getHttpServer())
      .get(availabilityUrl)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);
    expect(hasNineAm(before.body)).toBe(true);

    const created = await request(app.getHttpServer())
      .post('/bookings')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ staffId: staffRes.body.id, serviceId: serviceRes.body.id, startTime: `${MONDAY}T09:00:00.000Z` })
      .expect(201);

    // If BookingsService.create's cache invalidation didn't run, this
    // would still show the now-booked slot as available for up to the
    // 30s TTL — this is what actually proves invalidation works.
    const afterCreate = await request(app.getHttpServer())
      .get(availabilityUrl)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);
    expect(hasNineAm(afterCreate.body)).toBe(false);

    await request(app.getHttpServer())
      .patch(`/bookings/${created.body.id}/cancel`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);

    // Same proof, the other direction: cancelling must free the slot
    // immediately, not after the TTL.
    const afterCancel = await request(app.getHttpServer())
      .get(availabilityUrl)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);
    expect(hasNineAm(afterCancel.body)).toBe(true);
  });
});

describe('Login rate limiting (e2e)', () => {
  let app: INestApplication;

  // Deliberately its own app instance with NO login in beforeAll — the
  // throttler's counter is per-app-instance (in-memory storage), and a
  // prior successful login here would count toward the same 5/60s bucket
  // as the failed attempts below, making the 6th failed attempt appear
  // to trip the limit "for free" instead of proving the limit itself.
  beforeAll(async () => {
    app = await bootApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rate limits repeated failed login attempts with 429 on the 6th', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'admin@tenant.dev', password: 'wrong-password', tenantSlug: 'e2e-tenant-a' });

    const results = [];
    for (let i = 0; i < 6; i++) {
      // Sequential on purpose — the throttler counts requests as they
      // arrive; firing them in parallel wouldn't reliably prove ordering.
      // eslint-disable-next-line no-await-in-loop
      results.push(await attempt());
    }

    const statuses = results.map((r) => r.status);
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

describe('Login rate limiting behind a reverse proxy (e2e)', () => {
  let app: INestApplication;

  // TRUST_PROXY=1: supertest's connection (127.0.0.1) plays the platform's
  // load balancer, and the last X-Forwarded-For entry is the client address
  // that proxy saw. Own app instance, so it starts with an empty counter.
  beforeAll(async () => {
    app = await bootApp({ trustProxy: '1' });
  });

  afterAll(async () => {
    await app.close();
  });

  const failedLogin = (forwardedFor: string) =>
    request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', forwardedFor)
      .send({ email: 'admin@tenant.dev', password: 'wrong-password', tenantSlug: 'e2e-tenant-a' });

  it('limits each client separately: one client hitting the limit does not lock out another one behind the same proxy', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      // eslint-disable-next-line no-await-in-loop
      statuses.push((await failedLogin('203.0.113.10')).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);

    expect((await failedLogin('203.0.113.20')).status).toBe(401);
  });

  it('only trusts the configured hops: a client-supplied X-Forwarded-For entry does not dodge the limit', async () => {
    // The client forges a different first entry each time; the proxy still
    // appends the same real address, and that is the one that is counted.
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      // eslint-disable-next-line no-await-in-loop
      statuses.push((await failedLogin(`198.18.0.${i + 1}, 203.0.113.30`)).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });
});

describe('Login rate limiting shared by several API instances (THROTTLE_STORAGE=redis, e2e)', () => {
  let first: INestApplication;
  let second: INestApplication;

  beforeAll(async () => {
    first = await bootApp({ trustProxy: '1', throttleStorage: 'redis' });
    second = await bootApp({ trustProxy: '1', throttleStorage: 'redis' });
    await waitForRedis(first);
    await waitForRedis(second);
  });

  afterAll(async () => {
    await first.close();
    await second.close();
  });

  it('two instances behind one load balancer share one login budget per client', async () => {
    // A fresh client address per run: the counter lives in the shared Redis
    // for a minute, so a fixed address would collide with the previous run.
    const hex = () => Math.floor(Math.random() * 0x10000).toString(16);
    const client = `2001:db8::${hex()}:${hex()}:${hex()}`;
    const failedLoginOn = (app: INestApplication) =>
      request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', client)
        .send({ email: 'admin@tenant.dev', password: 'wrong-password', tenantSlug: 'e2e-tenant-a' });

    const statuses: number[] = [];
    for (const app of [first, first, first, second, second, second]) {
      // eslint-disable-next-line no-await-in-loop
      statuses.push((await failedLoginOn(app)).status);
    }

    // With per-process counters the second instance would start from zero
    // and answer 401 three more times.
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });
});
