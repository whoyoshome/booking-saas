import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ForbiddenException,
} from '@nestjs/common';
import { Observable, from, firstValueFrom } from 'rxjs';
import { Role } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { TenantContextStorage } from './tenant-context.storage';
import { AuthenticatedUser } from '../auth/types/jwt-payload.type';

/**
 * Wraps everything downstream of this interceptor — the route handler and
 * any repository/service calls made within it — inside a single PostgreSQL
 * transaction, with a session variable set via `set_config(..., true)`
 * (the parameterized equivalent of `SET LOCAL`) for the lifetime of that
 * transaction:
 *
 *   - SUPER_ADMIN         -> app.is_super_admin = 'true'
 *   - any other role      -> app.current_tenant_id = '<uuid>'
 *
 * RLS policies (Step 5) read those session variables via
 * current_setting(..., true) to decide which rows are visible. This
 * interceptor is the ONLY place in the codebase that sets them — no
 * repository or service should ever call set_config directly.
 *
 * Must be combined with JwtAuthGuard (guards run before interceptors in
 * Nest's execution order, so request.user is already populated here).
 * Requests with no authenticated user (login, refresh, health) skip
 * wrapping entirely — there is no tenant context to set and no
 * RLS-protected data to touch on those paths.
 *
 * KNOWN TRADE-OFF, stated plainly: every wrapped request now runs inside
 * an interactive Prisma transaction (default timeout 5s; extended to 10s
 * below). This is fine for ordinary CRUD but must NOT be combined with
 * slow external calls — e.g. the AI assistant's calls to Claude/OpenAI in
 * a later phase. Routes with slow external dependencies should not use
 * this interceptor, or should move the slow call outside the transaction.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextStorage,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;

    if (!user) {
      return next.handle();
    }

    return from(
      this.prisma.$transaction(
        async (tx) => {
          if (user.role === Role.SUPER_ADMIN) {
            await tx.$executeRaw`SELECT set_config('app.is_super_admin', 'true', true)`;
          } else {
            if (!user.tenantId) {
              // Defensive: TenantGuard should already have rejected this
              // request before it ever reached this interceptor. If we get
              // here, something upstream is misconfigured — fail loudly
              // instead of silently running without tenant isolation.
              throw new ForbiddenException('Missing tenant context.');
            }
            await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${user.tenantId}, true)`;
          }

          return this.tenantContext.run(tx, () =>
            firstValueFrom(next.handle()),
          );
        },
        { timeout: 10_000 },
      ),
    );
  }
}
