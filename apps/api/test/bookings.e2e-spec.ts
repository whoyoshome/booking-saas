import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const MONDAY = '2026-09-14';

/**
 * Staff schedule: 09:00-17:00. Service: duration 30 + buffer 10 = 40 min
 * slots. Grid (staff ∩ branch, unrestricted branch, no existing
 * bookings): 09:00, 09:40, 10:20, 11:00, 11:40, 12:20, 13:00, 13:40,
 * 14:20, 15:00, 15:40, 16:20. Every startTime used below is one of these
 * — since POST /bookings now validates the requested slot is one
 * GET /availability actually offered, an arbitrary non-grid time (like
 * the old tests' "10:15") would fail with 400 before ever reaching the
 * exclusion constraint.
 */
describe('Bookings (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let tenantAToken: string;
  let staffId: string;
  let serviceId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    const loginA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@tenant.dev', password: 'ChangeMe123!', tenantSlug: 'tenant-a' })
      .expect(200);
    tenantAToken = loginA.body.accessToken;

    const branchRes = await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Sucursal Bookings e2e' })
      .expect(201);

    const staffRes = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ email: `booking-staff-${Date.now()}@tenant-a.dev`, branchId: branchRes.body.id })
      .expect(201);
    staffId = staffRes.body.id;

    const serviceRes = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        branchId: branchRes.body.id,
        name: 'Servicio Bookings e2e',
        durationMinutes: 30,
        bufferMinutes: 10,
        price: 20000,
      })
      .expect(201);
    serviceId = serviceRes.body.id;

    await request(app.getHttpServer())
      .patch(`/staff/${staffId}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ serviceIds: [serviceId] })
      .expect(200);

    await request(app.getHttpServer())
      .post('/staff-schedules')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ staffId, dayOfWeek: 1, startTime: '09:00', endTime: '17:00' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a PENDING booking and endTime includes the buffer', async () => {
    const res = await request(app.getHttpServer())
      .post('/bookings')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ staffId, serviceId, startTime: `${MONDAY}T09:00:00.000Z` })
      .expect(201);

    expect(res.body.status).toBe('PENDING');
    // duration 30 + buffer 10 = 40 minutes -> 09:40Z
    expect(res.body.endTime).toBe(`${MONDAY}T09:40:00.000Z`);
  });

  it('rejects a startTime that does not land on an actual available slot with 400', async () => {
    // 09:15 is not a grid boundary (grid steps in 40-minute increments
    // from 09:00) — must be rejected before it ever reaches the database.
    await request(app.getHttpServer())
      .post('/bookings')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ staffId, serviceId, startTime: `${MONDAY}T09:15:00.000Z` })
      .expect(400);
  });

  it('a second sequential request for an already-booked slot is rejected by the exclusion constraint (409), not the app-level grid check', async () => {
    await request(app.getHttpServer())
      .post('/bookings')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ staffId, serviceId, startTime: `${MONDAY}T10:20:00.000Z` })
      .expect(201);

    // The write-path pre-check only validates against the schedule grid
    // (ignoreBookings: true), not existing bookings — so this second
    // request ALSO passes that check, exactly like the first did. Only
    // the actual INSERT, and PostgreSQL's exclusion constraint, catches
    // the conflict. This is intentional: see the anti-TOCTOU design note
    // in bookings.service.ts.
    await request(app.getHttpServer())
      .post('/bookings')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ staffId, serviceId, startTime: `${MONDAY}T10:20:00.000Z` })
      .expect(409);
  });

  it('THE critical test: two simultaneous requests for the same slot — exactly one succeeds (409 for the loser, not 400)', async () => {
    const slot = `${MONDAY}T13:00:00.000Z`;

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post('/bookings')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ staffId, serviceId, startTime: slot }),
      request(app.getHttpServer())
        .post('/bookings')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ staffId, serviceId, startTime: slot }),
    ]);

    const statuses = [first.status, second.status].sort();
    // Both requests call GET /availability's logic before either has
    // committed, so both see 13:00 as available and both pass the
    // app-level check — the race is only resolved at the database, by
    // the exclusion constraint. One 201, one 409, never two 201s. This is
    // the actual anti-double-booking guarantee the whole project was
    // designed around, proven under real concurrency.
    expect(statuses).toEqual([201, 409]);
  });

  it("rejects a service that does not belong to the staff member's branch with 400", async () => {
    const otherBranchRes = await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Otra sucursal bookings' })
      .expect(201);

    const otherServiceRes = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        branchId: otherBranchRes.body.id,
        name: 'Servicio de otra sucursal',
        durationMinutes: 30,
        price: 10000,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/bookings')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ staffId, serviceId: otherServiceRes.body.id, startTime: `${MONDAY}T15:00:00.000Z` })
      .expect(400);
  });

  it('confirm transitions PENDING -> CONFIRMED', async () => {
    const created = await request(app.getHttpServer())
      .post('/bookings')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ staffId, serviceId, startTime: `${MONDAY}T11:00:00.000Z` })
      .expect(201);

    const confirmed = await request(app.getHttpServer())
      .patch(`/bookings/${created.body.id}/confirm`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);

    expect(confirmed.body.status).toBe('CONFIRMED');
  });

  it('a CONFIRMED booking also blocks via the exclusion constraint (409) AND disappears from GET /availability (the read/write split)', async () => {
    // Write path: same 409-via-constraint behavior as PENDING above —
    // the exclusion constraint's WHERE clause covers PENDING and
    // CONFIRMED identically.
    await request(app.getHttpServer())
      .post('/bookings')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ staffId, serviceId, startTime: `${MONDAY}T11:00:00.000Z` })
      .expect(409);

    // Read path: GET /availability (ignoreBookings defaults to false)
    // DOES subtract it — 11:00 must not appear in the slot list.
    const avail = await request(app.getHttpServer())
      .get(`/availability?staffId=${staffId}&serviceId=${serviceId}&date=${MONDAY}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);

    expect(
      avail.body.slots.some((s: { startLocal: string }) => s.startLocal === '11:00'),
    ).toBe(false);
  });

  it('cancelling a booking frees the slot for a new one', async () => {
    await request(app.getHttpServer())
      .post('/bookings')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ staffId, serviceId, startTime: `${MONDAY}T14:00:00.000Z` })
      .expect(400); // 14:00 is not grid-aligned (14:20 is) — sanity check

    const created = await request(app.getHttpServer())
      .post('/bookings')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ staffId, serviceId, startTime: `${MONDAY}T14:20:00.000Z` })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/bookings/${created.body.id}/cancel`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/bookings')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ staffId, serviceId, startTime: `${MONDAY}T14:20:00.000Z` })
      .expect(201);
  });

  it('a CLIENT only sees their own bookings in GET /bookings, even within the same tenant', async () => {
    const prisma = moduleRef.get(PrismaService);
    const passwordHash = await argon2.hash('ClientPass123!', { type: argon2.argon2id });
    const tenantA = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'tenant-a' } });

    const clientA = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_super_admin', 'true', true)`;
      return tx.user.create({
        data: {
          tenantId: tenantA.id,
          email: `client-a-${Date.now()}@tenant-a.dev`,
          passwordHash,
          role: Role.CLIENT,
        },
      });
    });
    const clientB = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_super_admin', 'true', true)`;
      return tx.user.create({
        data: {
          tenantId: tenantA.id,
          email: `client-b-${Date.now()}@tenant-a.dev`,
          passwordHash,
          role: Role.CLIENT,
        },
      });
    });

    const loginClientA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: clientA.email, password: 'ClientPass123!', tenantSlug: 'tenant-a' })
      .expect(200);
    const loginClientB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: clientB.email, password: 'ClientPass123!', tenantSlug: 'tenant-a' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/bookings')
      .set('Authorization', `Bearer ${loginClientA.body.accessToken}`)
      .send({ staffId, serviceId, startTime: `${MONDAY}T15:40:00.000Z` })
      .expect(201);
    await request(app.getHttpServer())
      .post('/bookings')
      .set('Authorization', `Bearer ${loginClientB.body.accessToken}`)
      .send({ staffId, serviceId, startTime: `${MONDAY}T16:20:00.000Z` })
      .expect(201);

    const clientAView = await request(app.getHttpServer())
      .get('/bookings')
      .set('Authorization', `Bearer ${loginClientA.body.accessToken}`)
      .expect(200);

    expect(clientAView.body.every((b: { clientId: string }) => b.clientId === clientA.id)).toBe(
      true,
    );
    expect(clientAView.body.some((b: { clientId: string }) => b.clientId === clientB.id)).toBe(
      false,
    );
  });
});
