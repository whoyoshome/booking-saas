import { test, expect } from '@playwright/test';
import { API_URL } from './support/urls';
import { AUTH_FILE, accessTokenOf } from './support/session';
import { openSlotStep, slotLabel } from './support/booking-wizard';
import { formatTimeRange } from '../lib/format-date';
import { demoBranchId } from './support/api';
import type { Service } from '../lib/types';

test.use({ storageState: AUTH_FILE.client });

test('a client books a free slot and gets a PENDING booking', async ({ page, request }) => {
  const availability = await openSlotStep(page, request, 14);
  const slot = availability.slots[0];

  await page.getByRole('button', { name: slotLabel(availability, 0), exact: true }).click();
  // Confirm summary: the appointment (start + service duration, without the
  // buffer that slot.endUtc includes) in the shared format, plus duration and price.
  const service = (await request
    .get(`${API_URL}/services?branchId=${await demoBranchId(request)}`, {
      headers: { Authorization: `Bearer ${accessTokenOf('client')}` },
    })
    .then((r) => r.json())) as Service[];
  const { durationMinutes } = service.find((s) => s.id === availability.serviceId)!;
  const end = new Date(new Date(slot.startUtc).getTime() + durationMinutes * 60_000);
  await expect(page.getByText(formatTimeRange(slot.startUtc, end, availability.timezone))).toBeVisible();
  await expect(page.getByText('Duration', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Price: \$[\d,.]+$/)).toBeAttached();

  const created = page.waitForResponse((r) => r.url() === `${API_URL}/bookings` && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  expect((await created).status()).toBe(201);

  await expect(page.getByText('Booking created — status: Pending')).toBeVisible();
});

test('if someone else takes the slot first, the API answers 409 and the UI recovers', async ({ page, request }) => {
  // Different week than the test above so both stay independent.
  const availability = await openSlotStep(page, request, 21);
  const slot = availability.slots[0];

  await page.getByRole('button', { name: slotLabel(availability, 0), exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm booking' })).toBeVisible();

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
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  expect((await attempt).status()).toBe(409);
  await refreshedGrid;

  // Clear message, back on the slot grid (not a dead end), and the taken
  // slot is gone from the refreshed availability.
  await expect(page.getByText('Someone else just took that time')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Time' })).toBeVisible();
  await expect(page.getByRole('button', { name: slotLabel(availability, 0), exact: true })).toHaveCount(0);
});
