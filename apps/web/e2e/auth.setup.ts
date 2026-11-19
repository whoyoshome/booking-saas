import { existsSync } from 'node:fs';
import { test as setup, expect } from '@playwright/test';
import { AUTH_FILE, PASSWORD, accessTokenOf } from './support/session';
import { API_URL } from './support/urls';

// Logs in ONCE per role through the real UI and saves the session
// (localStorage tokens + bk_session cookie). Specs reuse it instead of
// logging in again: POST /auth/login is throttled to 5/min per IP.
const ACCOUNTS = [
  { role: 'client', email: 'cliente@tenant.dev' },
  { role: 'admin', email: 'admin@tenant.dev' },
] as const;

for (const { role, email } of ACCOUNTS) {
  setup(`log in as ${role}`, async ({ page, request }) => {
    // Local re-runs: keep a saved session the API still accepts, so two
    // runs in the same minute don't trip the login throttle. CI always
    // starts without .auth/ and goes through the real login below.
    if (existsSync(AUTH_FILE[role])) {
      const me = await request.get(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${accessTokenOf(role)}` },
      });
      if (me.ok()) return;
    }

    await page.goto('/login');
    await page.getByLabel('Tenant').selectOption('tenant-a');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.context().storageState({ path: AUTH_FILE[role] });
  });
}
