import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Uso: @Roles(Role.SUPER_ADMIN, Role.TENANT_ADMIN)
 * Debe combinarse con JwtAuthGuard + RolesGuard en el controller/handler.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
