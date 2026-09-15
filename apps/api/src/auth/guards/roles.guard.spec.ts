import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { AuthenticatedUser } from '../types/jwt-payload.type';

function mockContext(user: AuthenticatedUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function buildGuard(requiredRoles: Role[] | undefined): RolesGuard {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('passes through when the handler has no @Roles() metadata', () => {
    const guard = buildGuard(undefined);
    const ctx = mockContext({ id: '1', role: Role.CLIENT, tenantId: 't1' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('passes through when @Roles() metadata is an empty array', () => {
    const guard = buildGuard([]);
    const ctx = mockContext({ id: '1', role: Role.CLIENT, tenantId: 't1' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows a user whose role is in the required list', () => {
    const guard = buildGuard([Role.TENANT_ADMIN, Role.STAFF]);
    const ctx = mockContext({ id: '1', role: Role.STAFF, tenantId: 't1' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects a user whose role is not in the required list', () => {
    const guard = buildGuard([Role.TENANT_ADMIN]);
    const ctx = mockContext({ id: '1', role: Role.CLIENT, tenantId: 't1' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects when there is no user at all, even with required roles set', () => {
    const guard = buildGuard([Role.TENANT_ADMIN]);
    const ctx = mockContext(undefined);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
