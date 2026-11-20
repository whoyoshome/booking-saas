import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Holds a reference to the active tenant-scoped Prisma transaction client
 * for the duration of a single request, without having to thread it as a
 * parameter through every controller -> service -> repository call.
 *
 * Populated by TenantContextInterceptor at the start of a request and read
 * by PrismaService.client at the point a repository actually runs a query.
 * Node's AsyncLocalStorage correctly follows the async call chain (awaits,
 * promises, callbacks) within a single request without leaking into other
 * concurrent requests — this is what makes it safe to use as request-scoped
 * state without Nest's (slower) REQUEST-scoped providers.
 */
@Injectable()
export class TenantContextStorage {
  // `null` marks code running after the request transaction committed
  // (see AfterCommit): database access is refused there instead of
  // silently falling back to the raw, non-RLS-scoped client.
  private readonly als = new AsyncLocalStorage<Prisma.TransactionClient | null>();

  run<T>(client: Prisma.TransactionClient, callback: () => T): T {
    return this.als.run(client, callback);
  }

  /** Runs `callback` where any PrismaService.client access throws. */
  runWithoutDatabase<T>(callback: () => T): T {
    return this.als.run(null, callback);
  }

  getClient(): Prisma.TransactionClient | undefined {
    const store = this.als.getStore();
    if (store === null) {
      throw new Error(
        'Database access after the request transaction committed (AfterCommit step). ' +
          'Read the data before returning AfterCommit.',
      );
    }
    return store;
  }
}
