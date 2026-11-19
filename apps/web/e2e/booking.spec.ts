import { test, expect } from '@playwright/test';
import { API_URL } from './support/urls';
import { AUTH_FILE, accessTokenOf } from './support/session';
import { openSlotStep } from './support/booking-wizard';

test.use({ storageState: AUTH_FILE.client });

test('a client books a free slot and gets a PENDING booking', async ({ page, request }) => {
  const availability = await openSlotStep(page, request, 14);
  const slot = availability.slots[0];

  await page.getByRole('button', { name: slot.startLocal, exact: true }).click();
  await expect(page.getByText(`Horario: ${slot.startLocal} - ${slot.endLocal}`)).toBeVisible();

  const created = page.waitForResponse((r) => r.url() === `${API_URL}/bookings` && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Confirmar reserva' }).click();
  expect((await created).status()).toBe(201);

  await expect(page.getByText('Reserva creada — estado: PENDING')).toBeVisible();
});

test('if someone else takes the slot first, the API answers 409 and the UI recovers', async ({ page, request }) => {
  // Different week than the test above so both stay independent.
  const availability = await openSlotStep(page, request, 21);
  const slot = availability.slots[0];

  await page.getByRole('button', { name: slot.startLocal, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirmar reserva' })).toBeVisible();

  // The race, made deterministic: while the client is looking at the
  // confirm screen, the tenant admin books that exact staff + time
  // through the real API. Nothing is mocked — the conflict below comes
  // from PostgreSQL's EXCLUDE USING gist constraint on `bookings`.
  const competing = await request.post(`${API_URL}/bookings`, {
    headers: { Authorization: `Bearer ${accessTokenOf('admin')}` },
    data: {
      staffId: availability.staffId,
      serviceId: availability.serviceId,
      startTime: slot.startUtc,
    },
  });
  expect(competing.status()).toBe(201);

  const attempt = page.waitForResponse((r) => r.url() === `${API_URL}/bookings` && r.request().method() === 'POST');
  const refreshedGrid = page.waitForResponse((r) => r.url().includes('/availability?'));
  await page.getByRole('button', { name: 'Confirmar reserva' }).click();
  expect((await attempt).status()).toBe(409);
  await refreshedGrid;

  // Clear message, back on the slot grid (not a dead end), and the taken
  // slot is gone from the refreshed availability.
  await expect(page.getByText('Ese horario acaba de ser tomado por otra persona')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Horario' })).toBeVisible();
  await expect(page.getByRole('button', { name: slot.startLocal, exact: true })).toHaveCount(0);
});
