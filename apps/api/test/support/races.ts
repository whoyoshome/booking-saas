import { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Runs `fn` in a transaction scoped to one tenant, the same way
 * TenantContextInterceptor does (app.current_tenant_id; RLS applies).
 */
export function inTenant<T>(
  prisma: PrismaService,
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}

async function waitUntilAStatementIsBlocked(prisma: PrismaService, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_locks WHERE NOT granted`;
    if (waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('The contender never blocked on the uncommitted change.');
}

/**
 * Makes a read-then-write race deterministic.
 *
 * Applies `change` in a tenant-scoped transaction and keeps it open, so the
 * rows it touched stay locked and the change stays uncommitted. Starts
 * `contender`, waits until one of its statements is blocked on that lock,
 * then commits. Whatever the contender read before blocking is the old,
 * committed state; its write happens after `change` committed. Code that
 * writes without re-checking the state it read gets it wrong every time.
 */
export async function raceAgainstUncommittedChange<T>(
  prisma: PrismaService,
  tenantId: string,
  change: (tx: Prisma.TransactionClient) => Promise<unknown>,
  contender: () => PromiseLike<T>,
): Promise<T> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let markApplied!: () => void;
  const applied = new Promise<void>((resolve) => (markApplied = resolve));

  const holder = inTenant(prisma, tenantId, async (tx) => {
    await change(tx);
    markApplied();
    await released;
  });

  await Promise.race([applied, holder]);
  const result = Promise.resolve(contender());
  result.catch(() => undefined); // awaited below; avoids an unhandled-rejection warning meanwhile

  try {
    await waitUntilAStatementIsBlocked(prisma);
  } finally {
    release();
  }
  await holder;
  return result;
}
