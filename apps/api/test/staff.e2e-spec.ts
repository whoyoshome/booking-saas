import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Staff (e2e)', () => {
  let app: INestApplication;

  let tenantAToken: string;
  let tenantBToken: string;
  let branchAId: string;
  let branchAServiceId: string;
  let otherBranchServiceId: string;

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
      .send({ name: 'Sucursal Staff e2e' })
      .expect(201);
    branchAId = branchRes.body.id;

    const otherBranchRes = await request(app.getHttpServer())
      .post('/branches')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ name: 'Otra sucursal (misma tenant)' })
      .expect(201);

    const serviceRes = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        branchId: branchAId,
        name: 'Servicio para staff e2e',
        durationMinutes: 30,
        price: 20000,
      })
      .expect(201);
    branchAServiceId = serviceRes.body.id;

    const otherServiceRes = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        branchId: otherBranchRes.body.id,
        name: 'Servicio de otra sucursal',
        durationMinutes: 30,
        price: 20000,
      })
      .expect(201);
    otherBranchServiceId = otherServiceRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a staff member with a provisioned user and a temporary password', async () => {
    const res = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        email: `staff-${Date.now()}@tenant-a.dev`,
        branchId: branchAId,
        serviceIds: [branchAServiceId],
      })
      .expect(201);

    expect(res.body.branchId).toBe(branchAId);
    expect(res.body.user.email).toContain('@tenant-a.dev');
    expect(typeof res.body.temporaryPassword).toBe('string');
    expect(res.body.temporaryPassword.length).toBeGreaterThan(0);
  });

  it('rejects a duplicate email within the same tenant with 409', async () => {
    const email = `staff-dup-${Date.now()}@tenant-a.dev`;

    await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ email, branchId: branchAId })
      .expect(201);

    await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({ email, branchId: branchAId })
      .expect(409);
  });

  it('rejects a serviceId that belongs to a different branch with 400', async () => {
    await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${tenantAToken}`)
      .send({
        email: `staff-badservice-${Date.now()}@tenant-a.dev`,
        branchId: branchAId,
        serviceIds: [otherBranchServiceId], // wrong branch
      })
      .expect(400);
  });

  it("tenant B gets 404 creating staff on tenant A's branch, never 403 or 201", async () => {
    await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${tenantBToken}`)
      .send({
        email: `cross-tenant-${Date.now()}@tenant-b.dev`,
        branchId: branchAId,
      })
      .expect(404);
  });

  it('rejects a role without TENANT_ADMIN', async () => {
    const loginSuper = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@bookingsaas.dev', password: 'ChangeMe123!' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', `Bearer ${loginSuper.body.accessToken}`)
      .send({ email: 'no-deberia@existir.dev', branchId: branchAId })
      .expect(403);
  });

  it("tenant B cannot see any of tenant A's staff", async () => {
    const res = await request(app.getHttpServer())
      .get('/staff')
      .set('Authorization', `Bearer ${tenantBToken}`)
      .expect(200);

    const branchIds = res.body.map((s: { branchId: string }) => s.branchId);
    expect(branchIds).not.toContain(branchAId);
  });
});
