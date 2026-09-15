import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const MONDAY = '2026-09-14'; // real Monday, same date used in availability.e2e-spec.ts

describe('Branch schedules & availability intersection (e2e)', () => {
  let app: INestApplication;
  let tenantAToken: string;

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
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupStaffAndService(branchTimezone = 'America/Bogota') {
    const branchRes = await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: `Sucursal BranchSchedule e2e ${Date.now()}`, timezone: branchTimezone })
      .expect(201);
    const branchId = branchRes.body.id;

    const staffRes = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ email: `bs-${Date.now()}@tenant-a.dev`, branchId })
      .expect(201);
    const staffId = staffRes.body.id;

    const serviceRes = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ branchId, name: 'Servicio BranchSchedule e2e', durationMinutes: 30, bufferMinutes: 0, price: 10000 })
      .expect(201);
    const serviceId = serviceRes.body.id;

    await request(app.getHttpServer())
      .patch(`/staff/${staffId}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ serviceIds: [serviceId] })
      .expect(200);

    await request(app.getHttpServer())
      .post('/staff-schedules')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ staffId, dayOfWeek: 1, startTime: '09:00', endTime: '12:00' })
      .expect(201);

    return { branchId, staffId, serviceId };
  }

  it('a branch with NO BranchSchedule configured stays unrestricted (backward compatible)', async () => {
    const { staffId, serviceId } = await setupStaffAndService();

    const res = await request(app.getHttpServer())
      .get(`/availability?staffId=${staffId}&serviceId=${serviceId}&date=${MONDAY}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);

    expect(res.body.branchScheduleApplied).toBe(false);
    expect(res.body.slots).toHaveLength(6); // 09:00-12:00 in 30-min slots
  });

  it('once a BranchSchedule is configured, slots outside branch hours disappear (intersection)', async () => {
    const { branchId, staffId, serviceId } = await setupStaffAndService();

    // Branch only open 10:00-11:00 Mondays, narrower than the staff's
    // 09:00-12:00 schedule.
    await request(app.getHttpServer())
      .post('/branch-schedules')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ branchId, dayOfWeek: 1, startTime: '10:00', endTime: '11:00' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/availability?staffId=${staffId}&serviceId=${serviceId}&date=${MONDAY}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);

    expect(res.body.branchScheduleApplied).toBe(true);
    // Only the intersection 10:00-11:00 -> 2 slots, not the staff's full
    // 09:00-12:00 (6 slots).
    expect(res.body.slots).toHaveLength(2);
    expect(res.body.slots[0].startLocal).toBe('10:00');
    expect(res.body.slots[1].endLocal).toBe('11:00');
  });

  it('once opted in, a day of week with no BranchSchedule row is treated as closed', async () => {
    const { branchId, staffId, serviceId } = await setupStaffAndService();

    // Configure ONLY Tuesday (dayOfWeek=2) — Monday has no row at all.
    await request(app.getHttpServer())
      .post('/branch-schedules')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ branchId, dayOfWeek: 2, startTime: '09:00', endTime: '17:00' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/availability?staffId=${staffId}&serviceId=${serviceId}&date=${MONDAY}`) // Monday
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);

    expect(res.body.branchScheduleApplied).toBe(true);
    expect(res.body.slots).toHaveLength(0);
  });

  it('a BranchScheduleException with isOpen=false closes the branch that date, overriding an otherwise-open recurring schedule', async () => {
    const { branchId, staffId, serviceId } = await setupStaffAndService();

    await request(app.getHttpServer())
      .post('/branch-schedules')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ branchId, dayOfWeek: 1, startTime: '09:00', endTime: '12:00' })
      .expect(201);

    const holiday = '2026-09-21'; // also a Monday
    await request(app.getHttpServer())
      .post('/branch-schedule-exceptions')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ branchId, date: holiday, isOpen: false, reason: 'Remodelación' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/availability?staffId=${staffId}&serviceId=${serviceId}&date=${holiday}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);

    expect(res.body.slots).toHaveLength(0);
  });

  it('rejects an overlapping BranchSchedule block on the same day with 400', async () => {
    const { branchId } = await setupStaffAndService();

    await request(app.getHttpServer())
      .post('/branch-schedules')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ branchId, dayOfWeek: 3, startTime: '09:00', endTime: '13:00' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/branch-schedules')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ branchId, dayOfWeek: 3, startTime: '12:00', endTime: '15:00' })
      .expect(400);
  });

  it('rejects an invalid IANA timezone on branch creation with 400', async () => {
    await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Sucursal timezone inválida', timezone: 'Not/AZone' })
      .expect(400);
  });
});
