import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Fase 4, Step 2 — Services module. Same seed-data coupling documented in
 * tenant-isolation.e2e-spec.ts (tenant-a / tenant-b / admin@tenant.dev).
 * Run `npm run seed` before this suite.
 */
describe('Services (e2e)', () => {
  let app: INestApplication;

  let tenantAToken: string;
  let tenantBToken: string;
  let branchAId: string;

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

    // A fresh branch for THIS suite, not reused from the branches suite —
    // avoids depending on test execution order between spec files.
    const branchRes = await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Sucursal Norte (services e2e)' })
      .expect(201);
    branchAId = branchRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('tenant A creates a service on its own branch', async () => {
    const res = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        branchId: branchAId,
        name: 'Corte de cabello',
        durationMinutes: 30,
        bufferMinutes: 10,
        price: 25000,
      })
      .expect(201);

    expect(res.body.branchId).toBe(branchAId);
    expect(res.body.durationMinutes).toBe(30);
    expect(res.body.bufferMinutes).toBe(10);
  });

  it('defaults bufferMinutes to 0 when omitted', async () => {
    const res = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        branchId: branchAId,
        name: 'Consulta rápida',
        durationMinutes: 15,
        price: 10000,
      })
      .expect(201);

    expect(res.body.bufferMinutes).toBe(0);
  });

  it("rejects creating a service on another tenant's branch — 404, not 403 or 201", async () => {
    await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${tenantBToken}`)
      .send({
        branchId: branchAId, // belongs to tenant A
        name: 'Intento cross-tenant',
        durationMinutes: 30,
        price: 5000,
      })
      .expect(404);
  });

  it('lists services filtered by branchId', async () => {
    const res = await request(app.getHttpServer())
      .get(`/services?branchId=${branchAId}`)
      .set('Authorization', `Bearer ${tenantAToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.every((s: { branchId: string }) => s.branchId === branchAId)).toBe(
      true,
    );
  });

  it("tenant B cannot see tenant A's services at all, even unfiltered", async () => {
    const res = await request(app.getHttpServer())
      .get('/services')
      .set('Authorization', `Bearer ${tenantBToken}`)
      .expect(200);

    const branchIds = res.body.map((s: { branchId: string }) => s.branchId);
    expect(branchIds).not.toContain(branchAId);
  });

  it('rejects a role without TENANT_ADMIN trying to create a service', async () => {
    // No STAFF/CLIENT seeded yet — SUPER_ADMIN doubles as "a role without
    // TENANT_ADMIN" for this check, same substitution already used in the
    // Branches suite checklist.
    const loginSuper = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@bookingsaas.dev', password: 'ChangeMe123!' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${loginSuper.body.accessToken}`)
      .send({
        branchId: branchAId,
        name: 'No debería crear esto',
        durationMinutes: 30,
        price: 1000,
      })
      .expect(403);
  });
});
