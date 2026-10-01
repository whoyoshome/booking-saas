import { describe, expect, it } from 'vitest';
import { canOperateRole } from './roles';

describe('canOperateRole', () => {
  it.each(['TENANT_ADMIN', 'STAFF'] as const)('%s can operate', (role) => {
    expect(canOperateRole(role)).toBe(true);
  });

  it.each(['CLIENT', 'SUPER_ADMIN'] as const)('%s cannot', (role) => {
    expect(canOperateRole(role)).toBe(false);
  });

  it.each([null, undefined])('%s (no user yet) cannot', (role) => {
    expect(canOperateRole(role)).toBe(false);
  });
});
