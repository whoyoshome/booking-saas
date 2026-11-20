import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { startFakeOpenAi } from './support/fake-openai';

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
      .send({ email: 'admin@tenant.dev', password: 'ChangeMe123!', tenantSlug: 'e2e-tenant-a' })
      .expect(200);
    tenantAdminToken = loginAdmin.body.accessToken;

    // A CLIENT account, provisioned directly for this test the same way
    // bookings.e2e-spec.ts's isolation test does — no CLIENT registration
    // endpoint exists yet.
    const prisma = moduleRef.get(PrismaService);
    const tenantA = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'e2e-tenant-a' } });
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
      .send({ email: clientEmail, password: 'ChangeMe123!', tenantSlug: 'e2e-tenant-a' })
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

/**
 * The same endpoint against a simulated OpenAI (test/support/fake-openai.ts):
 * the real SDK talks to a local server whose speed and failures each test
 * controls. OPENAI_* variables are set for the whole describe, so the app
 * reads them however it reads them (at startup or per request).
 */
describe('POST /ai/assist with a simulated OpenAI (e2e)', () => {
  type FakeOpenAi = Awaited<ReturnType<typeof startFakeOpenAi>>;

  const saved: Record<string, string | undefined> = {};
  function setEnv(vars: Record<string, string>) {
    for (const [key, value] of Object.entries(vars)) {
      if (!(key in saved)) saved[key] = process.env[key];
      process.env[key] = value;
    }
  }
  function restoreEnv() {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
      delete saved[key];
    }
  }

  async function bootWithAdmin(): Promise<{ app: INestApplication; token: string }> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@tenant.dev', password: 'ChangeMe123!', tenantSlug: 'e2e-tenant-a' })
      .expect(200);
    return { app, token: login.body.accessToken };
  }

  const ask = (app: INestApplication, token: string) =>
    request(app.getHttpServer())
      .post('/ai/assist')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'How many bookings are pending?' });

  describe('with a 20 s client timeout', () => {
    let fake: FakeOpenAi;
    let app: INestApplication;
    let token: string;

    beforeAll(async () => {
      fake = await startFakeOpenAi();
      setEnv({ OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: fake.baseURL, OPENAI_TIMEOUT_MS: '20000' });
      ({ app, token } = await bootWithAdmin());
    });

    afterAll(async () => {
      await app.close();
      await fake.close();
      restoreEnv();
    });

    it("answers from the model, grounded on this tenant's pending bookings", async () => {
      fake.set({ delayMs: 0, status: 200, content: 'There are some pending bookings.' });
      const before = fake.requests.length;

      const res = await ask(app, token).expect(201);

      expect(res.body.answer).toBe('There are some pending bookings.');
      expect(fake.requests).toHaveLength(before + 1);
      const sent = fake.requests[before];
      expect(sent.messages[0].role).toBe('system');
      expect(sent.messages[1].content).toContain(
        `DATA (this tenant's PENDING bookings, ${res.body.groundedOnPendingBookings} of them)`,
      );
      expect(sent.messages[1].content).toContain('QUESTION: How many bookings are pending?');
    });

    it('still answers when the model is slower than the 10 s request transaction (the call runs after commit)', async () => {
      fake.set({ delayMs: 10_500, status: 200, content: 'Slow but fine.' });

      const res = await ask(app, token);

      expect(res.status).toBe(201);
      expect(res.body.answer).toBe('Slow but fine.');
    }, 30_000);

    it('makes one attempt on an upstream error and answers a clean 503 (no retries)', async () => {
      fake.set({ delayMs: 0, status: 500 });
      const before = fake.requests.length;

      const res = await ask(app, token).expect(503);

      expect(res.body.message).toBe('AI assist is temporarily unavailable.');
      expect(fake.requests).toHaveLength(before + 1);
    }, 30_000);
  });

  describe('with a 500 ms client timeout', () => {
    let fake: FakeOpenAi;
    let app: INestApplication;
    let token: string;

    beforeAll(async () => {
      fake = await startFakeOpenAi();
      setEnv({ OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: fake.baseURL, OPENAI_TIMEOUT_MS: '500' });
      ({ app, token } = await bootWithAdmin());
    });

    afterAll(async () => {
      await app.close();
      await fake.close();
      restoreEnv();
    });

    it('gives up on a model that does not answer in time with a clean 503', async () => {
      fake.set({ delayMs: 3_000, status: 200, content: 'Too late.' });
      const startedAt = Date.now();

      const res = await ask(app, token).expect(503);

      expect(res.body.message).toBe('AI assist did not answer in time.');
      expect(Date.now() - startedAt).toBeLessThan(2_500);
    }, 30_000);
  });
});
