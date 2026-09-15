import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const MONDAY = '2026-09-14';

async function bootApp(): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  return app;
}

describe('Fase 8: Redis cache invalidation (e2e)', () => {
  let app: INestApplication;
  let tenantAToken: string;

  beforeAll(async () => {
    app = await bootApp();
    const loginA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@tenant.dev', password: 'ChangeMe123!', tenantSlug: 'tenant-a' })
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

describe('Fase 8: login rate limiting (e2e)', () => {
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
        .send({ email: 'admin@tenant.dev', password: 'wrong-password', tenantSlug: 'tenant-a' });

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
