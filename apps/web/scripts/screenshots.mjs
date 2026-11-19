// Captures the README screenshots (docs/screenshots/*.png) from a running
// stack: login, dashboard, alerts (demo mode) and the five booking steps.
//
// Run it against a freshly seeded database (docker compose down -v, migrate,
// `npm run seed`, `npm run seed:demo`) and a production build of this app,
// BEFORE any e2e run, so no test data shows up:
//
//   node scripts/screenshots.mjs
//
// E2E_WEB_URL / E2E_API_URL override the default localhost:3000 / :3001,
// SCREENSHOTS_DIR the output folder. It signs in twice (client, then admin),
// well under the 5/min login throttle. It also creates three PENDING
// bookings for the client and confirms one as admin, so the dashboard has
// rows to show.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3000';
const API = process.env.E2E_API_URL ?? 'http://localhost:3001';
const OUT =
  process.env.SCREENSHOTS_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/screenshots');
const PASSWORD = 'ChangeMe123!';

mkdirSync(OUT, { recursive: true });

async function shot(page, name, fullPage = false) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0); // no hover state in the picture
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
  console.log(`saved ${name}.png`);
}

async function signIn(page, email) {
  await page.goto(`${WEB}/login`);
  await page.getByLabel('Business').selectOption('tenant-a');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/dashboard$/);
}

async function accessToken(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('booking_saas_tokens')).accessToken);
}

async function api(token, method, route, body) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status}`);
  return res.json();
}

/** yyyy-mm-dd of the n-th weekday after today (local calendar). */
function weekdayAfter(n) {
  const d = new Date();
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left -= 1;
  }
  return d.toLocaleDateString('en-CA');
}

const browser = await chromium.launch();
const newPage = async () => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'America/Bogota',
  });
  return context.newPage();
};

try {
  // 1. Login
  const loginPage = await newPage();
  await loginPage.goto(`${WEB}/login`);
  await expect(loginPage.getByLabel('Business')).toBeVisible();
  await shot(loginPage, 'login');

  // 2. Booking wizard, steps 1-5, as the client
  const client = await newPage();
  await signIn(client, 'cliente@tenant.dev');
  await client.goto(`${WEB}/book`);
  await expect(client.getByRole('button', { name: 'Downtown Branch' })).toBeVisible();
  await shot(client, 'book-1-branch');

  await client.getByRole('button', { name: 'Downtown Branch' }).click();
  await expect(client.getByRole('heading', { name: 'Service' })).toBeVisible();
  await shot(client, 'book-2-service');

  await client.getByRole('button', { name: /Haircut/ }).click();
  await expect(client.getByRole('heading', { name: 'Staff' })).toBeVisible();
  await shot(client, 'book-3-staff');

  const firstGrid = client.waitForResponse((r) => r.url().includes('/availability?'));
  await client.getByRole('button', { name: 'ana@tenant-a.dev' }).click();
  await firstGrid;
  const date = weekdayAfter(1);
  const grid = client.waitForResponse((r) => r.url().includes(`date=${date}`));
  await client.getByLabel('Date').fill(date);
  const availability = await (await grid).json();
  await client.getByLabel('Date').blur();
  if (availability.slots.length < 4) throw new Error(`Not enough free slots on ${date}.`);
  await expect(client.getByRole('heading', { name: 'Time' })).toBeVisible();
  await shot(client, 'book-4-time');

  const slotButtons = client.locator('section button');
  await slotButtons.nth(3).click();
  await expect(client.getByRole('heading', { name: 'Confirm' })).toBeVisible();
  await shot(client, 'book-5-confirm');

  await client.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(client.getByText(/Booking created/)).toBeVisible();

  // Two more PENDING bookings through the API, so the dashboard has a mix.
  const clientToken = await accessToken(client);
  const { staffId, serviceId, slots } = availability;
  const extra = [];
  for (const slot of [slots[0], slots[6] ?? slots[1]]) {
    extra.push(await api(clientToken, 'POST', '/bookings', { staffId, serviceId, startTime: slot.startUtc }));
  }

  // 3. Dashboard and alerts, as the tenant admin
  const admin = await newPage();
  await signIn(admin, 'admin@tenant.dev');
  await api(await accessToken(admin), 'PATCH', `/bookings/${extra[0].id}/confirm`);
  await admin.goto(`${WEB}/dashboard`);
  await expect(admin.getByRole('button', { name: 'Accept' }).first()).toBeVisible();
  await expect(admin.getByLabel('Question for the assistant')).toBeVisible();
  await shot(admin, 'dashboard', true);

  await admin.goto(`${WEB}/alerts?demo=1`);
  await expect(admin.getByRole('list', { name: 'Bookings by urgency' })).toBeVisible();
  await shot(admin, 'alerts-demo', true);
} finally {
  await browser.close();
}
