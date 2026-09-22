import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * KNOWN TESTING LIMITATION, stated explicitly (see docs/ai-assist.md):
 * CI has no OPENAI_API_KEY secret configured on purpose — this suite
 * therefore cannot exercise the actual LLM-call happy path, only the
 * guardrails that don't need a real key: RBAC, the 503-when-unconfigured
 * contract, and input validation. The RLS-scoping of the grounding query
 * itself (this.prisma.client, not this.prisma) is the same pattern
 * already proven extensively elsewhere (tenant-isolation.e2e-spec.ts) —
 * trusted here by consistency, not re-proven through this endpoint.
 */
describe('POST /ai/assist (e2e)', () => {
  let app: INestApplication;
  let tenantAdminToken: string;
  let clientToken: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@tenant.dev', password: 'ChangeMe123!', tenantSlug: 'tenant-a' })
      .expect(200);
    tenantAdminToken = loginAdmin.body.accessToken;

    // A CLIENT account, provisioned directly for this test the same way
    // bookings.e2e-spec.ts's isolation test does — no CLIENT registration
    // endpoint exists yet.
    const prisma = moduleRef.get(PrismaService);
    const tenantA = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'tenant-a' } });
    const clientEmail = `ai-assist-client-${Date.now()}@tenant-a.dev`;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_super_admin', 'true', true)`;
      await tx.user.create({
        data: {
          tenantId: tenantA.id,
          email: clientEmail,
          passwordHash: await argon2.hash('ChangeMe123!', { type: argon2.argon2id }),
          role: Role.CLIENT,
        },
      });
    });

    const loginClient = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: clientEmail, password: 'ChangeMe123!', tenantSlug: 'tenant-a' })
      .expect(200);
    clientToken = loginClient.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a CLIENT with 403 — TENANT_ADMIN/STAFF only', async () => {
    await request(app.getHttpServer())
      .post('/ai/assist')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ question: '¿Cuántas reservas pendientes hay?' })
      .expect(403);
  });

  it('rejects a request with no question with 400', async () => {
    await request(app.getHttpServer())
      .post('/ai/assist')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({})
      .expect(400);
  });

  it('rejects a question shorter than 3 characters with 400', async () => {
    await request(app.getHttpServer())
      .post('/ai/assist')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({ question: 'hi' })
      .expect(400);
  });

  it('returns 503 with a clear message when OPENAI_API_KEY is not configured — the real CI/default-environment behavior', async () => {
    const res = await request(app.getHttpServer())
      .post('/ai/assist')
      .set('Authorization', `Bearer ${tenantAdminToken}`)
      .send({ question: '¿Cuántas reservas pendientes hay?' })
      .expect(503);

    expect(res.body.message).toMatch(/OPENAI_API_KEY/);
  });

  it('rejects an unauthenticated request with 401', async () => {
    await request(app.getHttpServer())
      .post('/ai/assist')
      .send({ question: '¿Cuántas reservas pendientes hay?' })
      .expect(401);
  });
});
