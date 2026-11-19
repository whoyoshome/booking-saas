import { readFileSync } from 'node:fs';
import path from 'node:path';

export const PASSWORD = 'ChangeMe123!';

export const AUTH_FILE = {
  client: path.join(__dirname, '..', '.auth', 'client.json'),
  admin: path.join(__dirname, '..', '.auth', 'admin.json'),
};

/** Access token a role's saved session holds (written by auth.setup.ts). */
export function accessTokenOf(role: keyof typeof AUTH_FILE): string {
  const state = JSON.parse(readFileSync(AUTH_FILE[role], 'utf8')) as {
    origins: { localStorage: { name: string; value: string }[] }[];
  };
  const entry = state.origins
    .flatMap((o) => o.localStorage)
    .find((e) => e.name === 'booking_saas_tokens');
  if (!entry) throw new Error(`No saved session for ${role} — did auth.setup.ts run?`);
  return (JSON.parse(entry.value) as { accessToken: string }).accessToken;
}
