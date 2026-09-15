import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { TenantGuard } from './tenant.guard';
import { AuthenticatedUser } from '../types/jwt-payload.type';

function mockContext(user: AuthenticatedUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('TenantGuard', () => {
  const guard = new TenantGuard();

  it('allows SUPER_ADMIN through regardless of tenantId', () => {
    const ctx = mockContext({ id: '1', role: Role.SUPER_ADMIN, tenantId: null });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows a non-super-admin role with a valid tenantId', () => {
    const ctx = mockContext({ id: '1', role: Role.TENANT_ADMIN, tenantId: 'tenant-1' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects a non-super-admin role with no tenantId', () => {
    const ctx = mockContext({ id: '1', role: Role.TENANT_ADMIN, tenantId: null });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects when there is no authenticated user at all (guard-ordering defense)', () => {
    const ctx = mockContext(undefined);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
