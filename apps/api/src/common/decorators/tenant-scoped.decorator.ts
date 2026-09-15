import { applyDecorators, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantContextInterceptor } from '../../prisma/tenant-context.interceptor';

/**
 * Combines the full tenant-scoped request pipeline into one decorator:
 *
 *   JwtAuthGuard (who are you)
 *     -> TenantGuard (do you have a valid tenant context)
 *     -> RolesGuard (are you allowed here — a no-op if the handler has no
 *        @Roles() of its own)
 *     -> TenantContextInterceptor (open the RLS-scoped transaction for
 *        everything downstream: the handler, the service, the repository)
 *
 * We deliberately held off creating this until now (see the Step 4 notes
 * in the Fase 3 bitácora in README.md) — with a single demo route, writing
 * the four pieces out explicitly was clearer than a decorator hiding them.
 * Now that a second real controller (BranchesController) needs the exact
 * same stack, the repetition earns the abstraction.
 *
 * Usage:
 *   @Controller('branches')
 *   @TenantScoped()
 *   export class BranchesController {
 *     @Post()
 *     @Roles(Role.TENANT_ADMIN)   // further restricts just this route
 *     create(...) { ... }
 *
 *     @Get()                       // no @Roles() — any authenticated
 *     findAll(...) { ... }         // tenant-scoped role can list
 *   }
 */
export function TenantScoped() {
  return applyDecorators(
    UseGuards(JwtAuthGuard, TenantGuard, RolesGuard),
    UseInterceptors(TenantContextInterceptor),
  );
}
