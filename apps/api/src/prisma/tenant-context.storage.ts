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
  private readonly als = new AsyncLocalStorage<Prisma.TransactionClient>();

  run<T>(client: Prisma.TransactionClient, callback: () => T): T {
    return this.als.run(client, callback);
  }

  getClient(): Prisma.TransactionClient | undefined {
    return this.als.getStore();
  }
}
