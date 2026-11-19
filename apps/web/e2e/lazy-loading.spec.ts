import { test, expect, type Page, type Response } from '@playwright/test';
import { AUTH_FILE } from './support/session';

/**
 * The dashboard lazy-loads AiAssistBox (React.lazy + Suspense) because
 * only TENANT_ADMIN/STAFF render it. Chunk file names are content hashes,
 * so the assistant's code is identified by a string only it contains (its
 * input label; the frame around it lives in the page bundle).
 */
const ASSISTANT_CODE_MARKER = 'Question for the assistant';

/** Every JS file the page downloaded, with its body. */
async function loadDashboardScripts(page: Page) {
  const responses: Response[] = [];
  page.on('response', (r) => {
    if (r.request().resourceType() === 'script') responses.push(r);
  });
  await page.goto('/dashboard');
  await expect(page.getByText(/^Bookings( \(\d+\))?$/)).toBeVisible();
  await page.waitForLoadState('networkidle');
  return Promise.all(responses.map(async (r) => ({ url: r.url(), body: await r.text() })));
}

test.describe('as CLIENT', () => {
  test.use({ storageState: AUTH_FILE.client });

  test('never downloads the assistant code', async ({ page }) => {
    const scripts = await loadDashboardScripts(page);

    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.filter((s) => s.body.includes(ASSISTANT_CODE_MARKER)).map((s) => s.url)).toEqual([]);
    await expect(page.getByText('Assistant (beta)')).toHaveCount(0);
  });
});

test.describe('as TENANT_ADMIN', () => {
  test.use({ storageState: AUTH_FILE.admin });

  test('downloads the assistant as its own chunk, separate from the page bundle', async ({ page }) => {
    const scripts = await loadDashboardScripts(page);
    const withAssistant = scripts.filter((s) => s.body.includes(ASSISTANT_CODE_MARKER));

    expect(withAssistant).toHaveLength(1);
    expect(withAssistant[0].url).not.toContain('/app/dashboard/');
    await expect(page.getByLabel('Question for the assistant')).toBeVisible();
  });

  test('the placeholder holds the same space, so nothing shifts when the chunk arrives', async ({ page }) => {
    // Hold the assistant's chunk until the placeholder has been measured.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/_next/static/chunks/**/*.js', async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      if (body.includes(ASSISTANT_CODE_MARKER)) await held;
      await route.fulfill({ response, body });
    });

    await page.goto('/dashboard');
    const frame = page.locator('section', { has: page.getByRole('heading', { name: 'Assistant (beta)' }) });
    await expect(frame).toBeVisible();
    await expect(page.getByLabel('Question for the assistant')).toHaveCount(0); // still the placeholder
    const placeholderHeight = (await frame.boundingBox())!.height;

    release();
    await expect(page.getByLabel('Question for the assistant')).toBeVisible();
    expect((await frame.boundingBox())!.height).toBe(placeholderHeight);
  });
});
