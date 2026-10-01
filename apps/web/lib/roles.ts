import type { Role } from './types';

/**
 * Who sees the operational views (dashboard actions, /alerts). Mirrors the
 * API's own @Roles(TENANT_ADMIN, STAFF) — this is UI convenience, not the
 * security boundary; the API enforces the real restriction regardless.
 */
export function canOperateRole(role: Role | null | undefined): boolean {
  return role === 'TENANT_ADMIN' || role === 'STAFF';
}
