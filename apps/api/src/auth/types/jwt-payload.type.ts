import { Role } from '@prisma/client';

export interface JwtPayload {
  sub: string; // user id
  role: Role;
  tenantId: string | null;
}

export interface AuthenticatedUser {
  id: string;
  role: Role;
  tenantId: string | null;
}
