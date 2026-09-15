import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../types/jwt-payload.type';

/**
 * Gate, not a data filter. TenantGuard answers a single question: "does
 * this authenticated user have a valid tenant context to be here?" — it
 * does NOT decide which rows the user can see. That responsibility belongs
 * to RLS + `SET LOCAL app.current_tenant_id`, introduced in Steps 4 and 5.
 *
 * Must run after JwtAuthGuard (depends on request.user already being set).
 *
 * SUPER_ADMIN always passes — by design, it has no tenant. Every other
 * role is required to carry a tenantId. In practice this should never
 * reject anything if login is working correctly (every non-super-admin
 * user logs in via a tenantSlug and therefore gets a tenantId in their
 * JWT) — this guard exists as a defensive safety net, not as the primary
 * mechanism, the same way RLS in Step 5 backs up the application-level
 * filter instead of replacing it.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;

    if (!user) {
      // Should never happen if JwtAuthGuard ran first — defensive check
      // against a guard ordering mistake, not an expected runtime path.
      throw new ForbiddenException('Missing authentication context.');
    }

    if (user.role === Role.SUPER_ADMIN) {
      return true;
    }

    if (!user.tenantId) {
      throw new ForbiddenException(
        'This account is not associated with a tenant.',
      );
    }

    return true;
  }
}
