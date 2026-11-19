import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { AvailabilityResponse } from '../../lib/types';
import { formatTime } from '../../lib/format-date';
import { demoBranchId } from './api';

function isWeekend(d: Date): boolean {
  return d.getDay() === 0 || d.getDay() === 6;
}

/** Next Mon–Fri strictly after `d` (local calendar, no UTC parsing). */
function nextWeekday(d: Date): Date {
  const next = new Date(d);
  do next.setDate(next.getDate() + 1);
  while (isWeekend(next));
  return next;
}

function toDateInput(d: Date): string {
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n) => String(n).padStart(2, '0'))
    .join('-');
}

/** A slot button's label: its start time at the branch, e.g. "9:00 AM". */
export function slotLabel(availability: AvailabilityResponse, index: number): string {
  return formatTime(availability.slots[index].startUtc, availability.timezone);
}

/** Opens /book through the dashboard's deep link, landing on "Service". */
export async function openServiceStep(page: Page, request: APIRequestContext): Promise<void> {
  await page.goto(`/book?branchId=${await demoBranchId(request)}`);
  await expect(page.getByRole('heading', { name: 'Service' })).toBeVisible();
}

/**
 * On the "Time" step, picks the first weekday from `daysAhead` on that
 * still has free slots. Re-running the suite against the same local DB
 * fills days up, so it walks forward instead of assuming a fixed date is
 * empty. Returns the real API response the grid was rendered from.
 */
export async function pickDateWithSlots(page: Page, daysAhead: number): Promise<AvailabilityResponse> {
  const start = new Date();
  start.setDate(start.getDate() + daysAhead - 1);
  let day = nextWeekday(start);

  for (let attempt = 0; attempt < 15; attempt++, day = nextWeekday(day)) {
    const date = toDateInput(day);
    const gridLoaded = page.waitForResponse(
      (r) => r.url().includes('/availability?') && r.url().includes(`date=${date}`),
    );
    await page.getByLabel('Date').fill(date);
    const availability = (await (await gridLoaded).json()) as AvailabilityResponse;

    if (availability.slots.length > 0) {
      await expect(
        page.getByRole('button', { name: slotLabel(availability, 0), exact: true }),
      ).toBeVisible();
      return availability;
    }
  }
  throw new Error('No weekday with free slots found — is `npm run seed:demo` loaded?');
}

/**
 * Drives the wizard up to the "Time" step for the seed-demo data
 * (tenant-a: Sucursal Centro → Corte de cabello → ana@tenant-a.dev,
 * Mon–Fri 09:00–17:00 America/Bogota) and picks a date with free slots.
 */
export async function openSlotStep(
  page: Page,
  request: APIRequestContext,
  daysAhead: number,
): Promise<AvailabilityResponse> {
  await openServiceStep(page, request);
  await page.getByRole('button', { name: /Corte de cabello/ }).click();

  // Choosing staff loads today's grid first; wait for it so a late
  // response can't be mistaken for the date picked below.
  const initialGrid = page.waitForResponse((r) => r.url().includes('/availability?'));
  await page.getByRole('button', { name: 'ana@tenant-a.dev' }).click();
  await initialGrid;

  return pickDateWithSlots(page, daysAhead);
}
