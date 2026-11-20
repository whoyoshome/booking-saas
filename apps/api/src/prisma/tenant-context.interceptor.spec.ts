import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { firstValueFrom, of } from 'rxjs';
import { AfterCommit } from './after-commit';
import { PrismaService } from './prisma.service';
import { TenantContextInterceptor } from './tenant-context.interceptor';
import { TenantContextStorage } from './tenant-context.storage';

/**
 * The interceptor with a fake Prisma whose $transaction records when it has
 * committed. Only the AfterCommit hand-off is under test here; RLS itself is
 * covered by tenant-isolation.e2e-spec.ts.
 */
function setup() {
  const storage = new TenantContextStorage();
  const tx = { $executeRaw: jest.fn() } as unknown as Prisma.TransactionClient;
  const events: string[] = [];
  const prisma = {
    $transaction: jest.fn(async (fn: (client: Prisma.TransactionClient) => Promise<unknown>) => {
      const result = await fn(tx);
      events.push('committed');
      return result;
    }),
  } as unknown as PrismaService;

  const interceptor = new TenantContextInterceptor(prisma, storage);
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'user-1', role: Role.TENANT_ADMIN, tenantId: 'tenant-1' } }),
    }),
  } as unknown as ExecutionContext;
  const handlerReturning = (value: unknown): CallHandler => ({
    handle: () => {
      events.push(`handler saw transaction: ${storage.getClient() === tx}`);
      return of(value);
    },
  });

  return { storage, events, intercept: (value: unknown) => firstValueFrom(interceptor.intercept(context, handlerReturning(value))) };
}

describe('TenantContextInterceptor', () => {
  it('passes a normal handler result through', async () => {
    const { intercept, events } = setup();

    await expect(intercept({ ok: true })).resolves.toEqual({ ok: true });
    expect(events).toEqual(['handler saw transaction: true', 'committed']);
  });

  it('runs an AfterCommit step only after the transaction committed, and responds with its result', async () => {
    const { intercept, events } = setup();

    const result = await intercept(
      new AfterCommit(async () => {
        events.push('step');
        return 'answer';
      }),
    );

    expect(result).toBe('answer');
    expect(events).toEqual(['handler saw transaction: true', 'committed', 'step']);
  });

  it('refuses database access inside the AfterCommit step instead of falling back to the raw client', async () => {
    const { intercept, storage } = setup();

    await expect(
      intercept(new AfterCommit(async () => storage.getClient())),
    ).rejects.toThrow(/Database access after the request transaction committed/);
  });

  it('propagates an error thrown by the step (e.g. a 503 from the AI call)', async () => {
    const { intercept } = setup();

    await expect(
      intercept(
        new AfterCommit(async () => {
          throw new Error('upstream down');
        }),
      ),
    ).rejects.toThrow('upstream down');
  });
});
