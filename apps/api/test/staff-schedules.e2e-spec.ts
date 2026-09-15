import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Staff schedules & exceptions (e2e)', () => {
  let app: INestApplication;

  let tenantAToken: string;
  let tenantBToken: string;
  let staffAId: string;

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

    const loginB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'admin@tenant.dev',
        password: 'ChangeMe123!',
        tenantSlug: 'tenant-b',
      })
      .expect(200);
    tenantBToken = loginB.body.accessToken;

    const branchRes = await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Sucursal schedules e2e' })
      .expect(201);

    const staffRes = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        email: `staff-schedules-${Date.now()}@tenant-a.dev`,
        branchId: branchRes.body.id,
      })
      .expect(201);
    staffAId = staffRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('StaffSchedule', () => {
    it('creates a recurring block and returns HH:mm strings', async () => {
      const res = await request(app.getHttpServer())
        .post('/staff-schedules')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ staffId: staffAId, dayOfWeek: 1, startTime: '09:00', endTime: '12:00' })
        .expect(201);

      expect(res.body.startTime).toBe('09:00');
      expect(res.body.endTime).toBe('12:00');
      expect(res.body.dayOfWeek).toBe(1);
    });

    it('allows a second, non-overlapping block the same day (afternoon shift)', async () => {
      await request(app.getHttpServer())
        .post('/staff-schedules')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ staffId: staffAId, dayOfWeek: 1, startTime: '14:00', endTime: '18:00' })
        .expect(201);
    });

    it('rejects an overlapping block on the same day with 400', async () => {
      await request(app.getHttpServer())
        .post('/staff-schedules')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ staffId: staffAId, dayOfWeek: 1, startTime: '11:00', endTime: '15:00' })
        .expect(400);
    });

    it('rejects endTime <= startTime (no overnight spans in v1)', async () => {
      await request(app.getHttpServer())
        .post('/staff-schedules')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ staffId: staffAId, dayOfWeek: 2, startTime: '22:00', endTime: '06:00' })
        .expect(400);
    });

    it("tenant B gets 404 creating a schedule for tenant A's staff", async () => {
      await request(app.getHttpServer())
        .post('/staff-schedules')
        .set('Authorization', `Bearer ${tenantBToken}`)
        .send({ staffId: staffAId, dayOfWeek: 3, startTime: '09:00', endTime: '12:00' })
        .expect(404);
    });
  });

  describe('StaffScheduleException', () => {
    it('rejects isAvailable=true without times', async () => {
      await request(app.getHttpServer())
        .post('/staff-schedule-exceptions')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ staffId: staffAId, date: '2026-12-24', isAvailable: true })
        .expect(400);
    });

    it('rejects isAvailable=false WITH times (contradictory)', async () => {
      await request(app.getHttpServer())
        .post('/staff-schedule-exceptions')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({
          staffId: staffAId,
          date: '2026-12-25',
          isAvailable: false,
          startTime: '09:00',
          endTime: '12:00',
        })
        .expect(400);
    });

    it('accepts isAvailable=false with no times (holiday)', async () => {
      const res = await request(app.getHttpServer())
        .post('/staff-schedule-exceptions')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({
          staffId: staffAId,
          date: '2026-12-25',
          isAvailable: false,
          reason: 'Navidad',
        })
        .expect(201);

      expect(res.body.startTime).toBeNull();
      expect(res.body.endTime).toBeNull();
    });

    it('accepts isAvailable=true with valid times', async () => {
      const res = await request(app.getHttpServer())
        .post('/staff-schedule-exceptions')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({
          staffId: staffAId,
          date: '2026-12-27',
          isAvailable: true,
          startTime: '10:00',
          endTime: '13:00',
          reason: 'Turno especial de fin de año',
        })
        .expect(201);

      expect(res.body.startTime).toBe('10:00');
      expect(res.body.endTime).toBe('13:00');
    });

    it('rejects a second exception for the same staff+date with 409', async () => {
      await request(app.getHttpServer())
        .post('/staff-schedule-exceptions')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ staffId: staffAId, date: '2026-12-25', isAvailable: true, startTime: '09:00', endTime: '10:00' })
        .expect(409);
    });

    it('PATCH with only reason on an isAvailable:true exception does not re-demand times (regression test for the fix)', async () => {
      const created = await request(app.getHttpServer())
        .post('/staff-schedule-exceptions')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({
          staffId: staffAId,
          date: '2027-01-02',
          isAvailable: true,
          startTime: '08:00',
          endTime: '09:00',
          reason: 'Turno inicial',
        })
        .expect(201);

      const patched = await request(app.getHttpServer())
        .patch(`/staff-schedule-exceptions/${created.body.id}`)
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ reason: 'Motivo actualizado' })
        .expect(200);

      expect(patched.body.reason).toBe('Motivo actualizado');
      // Untouched fields must survive the partial update unchanged.
      expect(patched.body.startTime).toBe('08:00');
      expect(patched.body.endTime).toBe('09:00');
      expect(patched.body.isAvailable).toBe(true);
    });
  });
});
