import { defineConfig, devices } from '@playwright/test';
import { API_URL, WEB_URL } from './e2e/support/urls';

/**
 * Full-stack E2E: real Next.js production build + real NestJS API +
 * real PostgreSQL/Redis. Nothing is mocked — the 409 test depends on the
 * actual EXCLUDE USING gist constraint on `bookings`.
 *
 * Prerequisites (CI does all of this in .github/workflows/frontend.yml):
 * Postgres + Redis up, migrations applied, `npm run seed` AND
 * `npm run seed:demo` run in apps/api (the base seed has no branches or
 * staff), `npm run build` done in both apps/api and apps/web. Locally,
 * an API/web already listening on :3001/:3000 (e.g. docker compose) is
 * reused instead of started.
 */
const CI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  // One worker on purpose: every spec writes to the same real database,
  // and POST /auth/login is throttled to 5/min per IP.
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  // No retries: a flaky test should show up red, not be hidden.
  retries: 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: CI ? 'retain-on-failure' : 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
  webServer: [
    {
      // Same entry point as apps/api/Dockerfile.prod (Nest emits under dist/src/).
      command: 'node ../api/dist/src/main.js',
      url: `${API_URL}/health`,
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
    {
      // The same artifact apps/web/Dockerfile.prod ships (output: 'standalone'),
      // assembled the same way: static assets and public/ copied next to
      // server.js. Requires a prior `npm run build`.
      command:
        'cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/ && node .next/standalone/server.js',
      url: `${WEB_URL}/login`,
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
  ],
});
