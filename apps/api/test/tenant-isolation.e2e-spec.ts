import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Fase 3, Paso 7 — tenant isolation integration tests. This is the formal
 * close-out of the whole phase: everything from Steps 1-5 (Tenant model,
 * tenantSlug login, TenantGuard, TenantContextInterceptor, RLS policy) is
 * exercised together here, both through the HTTP layer and by talking to
 * PostgreSQL directly.
 *
 * KNOWN COUPLING, stated explicitly: these tests rely on the seed data
 * from `prisma/seed.ts` (tenant-a / tenant-b / admin@tenant.dev /
 * ChangeMe123!, plus the SUPER_ADMIN) instead of creating their own
 * throwaway fixtures. Run `npm run seed` before this suite. Building
 * proper test fixtures with setup/teardown per test file is the more
 * correct long-term approach, but is not worth the extra infrastructure
 * yet for a project at this stage — noted here so it isn't mistaken for
 * an oversight later.
 */
describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let tenantAToken: string;
  let tenantBToken: string;
  let superAdminToken: string;
  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // Same global pipe as main.ts — tests should exercise the app exactly
    // as it runs in practice, not a stripped-down version of it.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = moduleRef.get(PrismaService);

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

    const loginSuper = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'admin@bookingsaas.dev',
        password: 'ChangeMe123!',
      })
      .expect(200);
    superAdminToken = loginSuper.body.accessToken;

    const tenantA = await prisma.tenant.findUniqueOrThrow({
      where: { slug: 'tenant-a' },
    });
    const tenantB = await prisma.tenant.findUniqueOrThrow({
      where: { slug: 'tenant-b' },
    });
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('HTTP layer — GET /auth/db-tenant-check', () => {
    it("tenant A's token reports tenant A's own id, in both the JWT and the Postgres session", async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/db-tenant-check')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .expect(200);

      expect(res.body.jwtTenantId).toBe(tenantAId);
      expect(res.body.postgresSessionTenantId).toBe(tenantAId);
      expect(res.body.postgresSessionIsSuperAdmin).toBeNull();
    });

    it("tenant B's token reports tenant B's own id, never tenant A's", async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/db-tenant-check')
        .set('Authorization', `Bearer ${tenantBToken}`)
        .expect(200);

      expect(res.body.jwtTenantId).toBe(tenantBId);
      expect(res.body.postgresSessionTenantId).toBe(tenantBId);
      expect(res.body.postgresSessionTenantId).not.toBe(tenantAId);
    });

    it('super admin activates the is_super_admin bypass, not a tenantId', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/db-tenant-check')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(res.body.jwtTenantId).toBeNull();
      expect(res.body.postgresSessionTenantId).toBeNull();
      expect(res.body.postgresSessionIsSuperAdmin).toBe('true');
    });

    it('rejects requests with no token', async () => {
      await request(app.getHttpServer())
        .get('/auth/db-tenant-check')
        .expect(401);
    });

    it('two concurrent requests from different tenants do not cross context', async () => {
      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .get('/auth/db-tenant-check')
          .set('Authorization', `Bearer ${tenantAToken}`),
        request(app.getHttpServer())
          .get('/auth/db-tenant-check')
          .set('Authorization', `Bearer ${tenantBToken}`),
      ]);

      expect(resA.body.postgresSessionTenantId).toBe(tenantAId);
      expect(resB.body.postgresSessionTenantId).toBe(tenantBId);
    });
  });

  describe('Database layer — RLS enforced directly (bypassing the HTTP/JWT layer entirely)', () => {
    it('returns zero rows when no tenant context is set, never an error', async () => {
      const rows = await prisma.$transaction(async (tx) => {
        // Deliberately does NOT call set_config — this is exactly the
        // "nobody set a session variable" case the NULLIF fallback in the
        // policy exists to handle safely.
        return tx.$queryRaw`SELECT id FROM users`;
      });

      expect(rows).toEqual([]);
    });

    it('only returns rows belonging to the tenant set via set_config', async () => {
      const rowsForA = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantAId}, true)`;
        return tx.$queryRaw<{ tenant_id: string }[]>`SELECT tenant_id FROM users`;
      });

      expect(rowsForA.length).toBeGreaterThan(0);
      expect(rowsForA.every((r) => r.tenant_id === tenantAId)).toBe(true);
    });

    it('switching tenant context in a fresh transaction returns the other tenant only', async () => {
      const rowsForB = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantBId}, true)`;
        return tx.$queryRaw<{ tenant_id: string }[]>`SELECT tenant_id FROM users`;
      });

      expect(rowsForB.length).toBeGreaterThan(0);
      expect(rowsForB.every((r) => r.tenant_id === tenantBId)).toBe(true);
    });

    it('the is_super_admin bypass sees rows from every tenant at once', async () => {
      const allRows = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.is_super_admin', 'true', true)`;
        return tx.$queryRaw<{ tenant_id: string | null }[]>`SELECT tenant_id FROM users`;
      });

      const distinctTenantIds = new Set(allRows.map((r) => r.tenant_id));
      expect(distinctTenantIds.has(tenantAId)).toBe(true);
      expect(distinctTenantIds.has(tenantBId)).toBe(true);
    });
  });

  describe('Cross-tenant resource access — branches (Phase 4, Step 1)', () => {
    let branchIdOfTenantA: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/branches')
        .set('Authorization', `Bearer ${tenantAToken}`)
        .send({ name: 'Sucursal Centro' })
        .expect(201);
      branchIdOfTenantA = res.body.id;
    });

    it('tenant A can read the branch it just created', async () => {
      await request(app.getHttpServer())
        .get(`/branches/${branchIdOfTenantA}`)
        .set('Authorization', `Bearer ${tenantAToken}`)
        .expect(200);
    });

    it("tenant B gets 404, never 403, requesting tenant A's branch by id — the exact rule from the Phase 0 Technical Plan", async () => {
      await request(app.getHttpServer())
        .get(`/branches/${branchIdOfTenantA}`)
        .set('Authorization', `Bearer ${tenantBToken}`)
        .expect(404);
    });

    it("tenant B cannot update tenant A's branch either (still 404, not 403)", async () => {
      await request(app.getHttpServer())
        .patch(`/branches/${branchIdOfTenantA}`)
        .set('Authorization', `Bearer ${tenantBToken}`)
        .send({ name: 'Intento de secuestro de sucursal' })
        .expect(404);
    });
  });
});
