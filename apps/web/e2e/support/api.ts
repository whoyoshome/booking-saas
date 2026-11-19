import { expect, type APIRequestContext } from '@playwright/test';
import type { AvailabilityResponse, Booking, Branch, Service, Staff } from '../../lib/types';
import { accessTokenOf } from './session';
import { API_URL } from './urls';

async function getAs<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${accessTokenOf('client')}` },
  });
  expect(res.ok(), `GET ${path} -> ${res.status()}`).toBeTruthy();
  return (await res.json()) as T;
}

/**
 * The seed-demo branch is identified by name AND timezone: the API's own
 * e2e suite also creates a "Sucursal Centro" in tenant-a (UTC, no staff),
 * so on a local DB where both suites ran, the name alone is ambiguous.
 */
export async function demoBranchId(request: APIRequestContext): Promise<string> {
  const branch = (await getAs<Branch[]>(request, '/branches')).find(
    (b) => b.name === 'Downtown Branch' && b.timezone === 'America/Bogota',
  );
  if (!branch) throw new Error('seed-demo branch not found — run `npm run seed:demo` in apps/api.');
  return branch.id;
}

/**
 * Creates a real PENDING booking for the seed-demo client, through the
 * API, so a test that needs one on screen doesn't depend on another spec
 * having run first.
 */
export async function createPendingBooking(request: APIRequestContext): Promise<Booking> {
  const branchId = await demoBranchId(request);
  const [service] = await getAs<Service[]>(request, `/services?branchId=${branchId}`);
  const staff = (await getAs<Staff[]>(request, `/staff?branchId=${branchId}`)).find((s) =>
    s.services.some((a) => a.service.id === service.id),
  );
  if (!staff) throw new Error('seed-demo staff not found.');

  const day = new Date();
  day.setDate(day.getDate() + 35);
  for (let i = 0; i < 30; i++, day.setDate(day.getDate() + 1)) {
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    const date = day.toLocaleDateString('en-CA'); // yyyy-mm-dd, local calendar
    const { slots } = await getAs<AvailabilityResponse>(
      request,
      `/availability?staffId=${staff.id}&serviceId=${service.id}&date=${date}`,
    );
    if (slots.length === 0) continue;

    const res = await request.post(`${API_URL}/bookings`, {
      headers: { Authorization: `Bearer ${accessTokenOf('client')}` },
      data: { staffId: staff.id, serviceId: service.id, startTime: slots[0].startUtc },
    });
    expect(res.status()).toBe(201);
    return (await res.json()) as Booking;
  }
  throw new Error('No free slot found for a PENDING booking.');
}
