import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// 2026-09-14 is a real Monday (dayOfWeek=1) relative to "today" in this
// project's timeline (Thursday, 2026-09-10) — picked deliberately so the
// StaffSchedule's dayOfWeek=1 rows actually apply to this test date.
const MONDAY = '2026-09-14';

describe('Availability (e2e)', () => {
  let app: INestApplication;
  let tenantAToken: string;
  let staffId: string;
  let serviceId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    const loginA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'admin@tenant.dev',
        password: 'ChangeMe123!',
        tenantSlug: 'tenant-a',
      })
      .expect(200);
    tenantAToken = loginA.body.accessToken;

    // America/Bogota: fixed UTC-5, no DST — deliberately chosen so the
    // expected UTC offset in assertions is stable and never flaky around
    // DST transition dates.
    const branchRes = await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Sucursal Availability e2e', timezone: 'America/Bogota' })
      .expect(201);

    const staffRes = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        email: `avail-${Date.now()}@tenant-a.dev`,
        branchId: branchRes.body.id,
      })
      .expect(201);
    staffId = staffRes.body.id;

    const serviceRes = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        branchId: branchRes.body.id,
        name: 'Servicio Availability e2e',
        durationMinutes: 30,
        bufferMinutes: 0,
        price: 10000,
      })
      .expect(201);
    serviceId = serviceRes.body.id;

    // Assign the service to the staff member (required — staff must be
    // qualified for the service to appear as available for it).
    await request(app.getHttpServer())
      .patch(`/staff/${staffId}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ serviceIds: [serviceId] })
      .expect(200);

    // Monday 09:00-11:00 local -> with 30-minute slots (duration 30 +
    // buffer 0), expect exactly 4 slots: 09:00, 09:30, 10:00, 10:30.
    await request(app.getHttpServer())
      .post('/staff-schedules')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ staffId, dayOfWeek: 1, startTime: '09:00', endTime: '11:00' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('slices a 2-hour block into four 30-minute slots', async () => {
    const res = await request(app.getHttpServer())
      .get(`/availability?staffId=${staffId}&serviceId=${serviceId}&date=${MONDAY}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);

    expect(res.body.slots).toHaveLength(4);
    expect(res.body.slots[0].startLocal).toBe('09:00');
    expect(res.body.slots[0].endLocal).toBe('09:30');
    expect(res.body.slots[3].startLocal).toBe('10:30');
    expect(res.body.slots[3].endLocal).toBe('11:00');
  });

  it('converts local time to the correct UTC instant using the branch timezone (America/Bogota, UTC-5)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/availability?staffId=${staffId}&serviceId=${serviceId}&date=${MONDAY}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);

    // 09:00 America/Bogota (UTC-5) == 14:00 UTC on the same calendar day.
    expect(res.body.slots[0].startUtc).toBe(`${MONDAY}T14:00:00.000Z`);
  });

  it('an isAvailable=false exception returns zero slots, even though the recurring schedule would allow it', async () => {
    const holiday = '2026-09-21'; // also a Monday
    await request(app.getHttpServer())
      .post('/staff-schedule-exceptions')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ staffId, date: holiday, isAvailable: false, reason: 'Día libre' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/availability?staffId=${staffId}&serviceId=${serviceId}&date=${holiday}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);

    expect(res.body.slots).toHaveLength(0);
  });

  it('an isAvailable=true exception REPLACES the recurring schedule, not merges with it', async () => {
    const specialDay = '2026-09-28'; // also a Monday
    await request(app.getHttpServer())
      .post('/staff-schedule-exceptions')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        staffId,
        date: specialDay,
        isAvailable: true,
        startTime: '15:00',
        endTime: '16:00',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/availability?staffId=${staffId}&serviceId=${serviceId}&date=${specialDay}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);

    // Only the exception's window (15:00-16:00 -> 2 slots), NOT the
    // regular 09:00-11:00 schedule too.
    expect(res.body.slots).toHaveLength(2);
    expect(res.body.slots[0].startLocal).toBe('15:00');
  });

  it('rejects a staff member not qualified for the requested service with 400', async () => {
    const staffLookup = await request(app.getHttpServer())
      .get(`/staff/${staffId}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);

    const otherServiceRes = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        branchId: staffLookup.body.branchId,
        name: 'Servicio no asignado',
        durationMinutes: 15,
        price: 5000,
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/availability?staffId=${staffId}&serviceId=${otherServiceRes.body.id}&date=${MONDAY}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(400);
  });

  it('rejects malformed query params with 400', async () => {
    await request(app.getHttpServer())
      .get(`/availability?staffId=not-a-uuid&serviceId=${serviceId}&date=${MONDAY}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(400);
  });

  it('defense in depth: rejects when staff was later moved to a different branch than the (still-qualified) service — the Fase 4 known gap', async () => {
    // Reproduces exactly the scenario the Fase 4 bitácora flagged as a
    // known gap: StaffService rows are validated against the staff's
    // branch only AT ASSIGNMENT TIME. Moving staff to a different branch
    // afterward does not retroactively invalidate that qualification.
    const otherBranchRes = await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Sucursal destino del traslado' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/staff/${staffId}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ branchId: otherBranchRes.body.id })
      .expect(200);

    // staffId is still linked to serviceId via the old StaffService row,
    // but staff.branchId and service.branchId now disagree.
    await request(app.getHttpServer())
      .get(`/availability?staffId=${staffId}&serviceId=${serviceId}&date=${MONDAY}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(400);
  });
});
