import { PENDING_TTL_MINUTES } from './alerts';
import type { Booking } from './types';

// Demo fixtures for /alerts?demo=1. Why fixtures instead of seeding the DB:
// the API cancels every PENDING booking older than PENDING_TTL_MINUTES
// (cron, every minute), so seeded PENDING rows would turn CANCELLED within
// ~10 minutes and the public demo would lose its alerts.
//
// All times are offsets from `now`, never absolute dates, so the fixtures
// never go stale. PENDING createdAt is derived from "minutes until expiry"
// so the countdown stays consistent with PENDING_TTL_MINUTES.

const MS_PER_MINUTE = 60_000;
const HOUR = 60;
const DAY = 24 * HOUR;

interface Fixture {
  id: string;
  service: string;
  branch: string;
  staff: string;
  client: string;
  status: Booking['status'];
  /** Minutes from now until the booking starts (negative = already started). */
  startsInMin: number;
  durationMin: number;
  /** PENDING only: minutes left before the hold expires. */
  expiresInMin?: number;
}

const FIXTURES: Fixture[] = [
  // CRITICAL: expiring within minutes
  { id: 'demo-01', service: 'Corte de cabello', branch: 'Sucursal Centro', staff: 'ana@tenant-a.dev', client: 'laura.g@example.com', status: 'PENDING', startsInMin: 3 * HOUR, durationMin: 30, expiresInMin: 1 },
  { id: 'demo-02', service: 'Tinte', branch: 'Sucursal Norte', staff: 'luis@tenant-a.dev', client: 'mateo.r@example.com', status: 'PENDING', startsInMin: DAY, durationMin: 90, expiresInMin: 2 },
  // CRITICAL: starting soon and still not confirmed
  { id: 'demo-03', service: 'Barba', branch: 'Sucursal Centro', staff: 'luis@tenant-a.dev', client: 'camila.p@example.com', status: 'PENDING', startsInMin: 40, durationMin: 20, expiresInMin: 8 },
  // HIGH: pending, plenty of time but needs a decision
  { id: 'demo-04', service: 'Manicure', branch: 'Sucursal Norte', staff: 'ana@tenant-a.dev', client: 'sofia.m@example.com', status: 'PENDING', startsInMin: 2 * HOUR + 15, durationMin: 45, expiresInMin: 7 },
  { id: 'demo-05', service: 'Corte de cabello', branch: 'Sucursal Centro', staff: 'ana@tenant-a.dev', client: 'andres.v@example.com', status: 'PENDING', startsInMin: DAY + 2 * HOUR, durationMin: 30, expiresInMin: 5 },
  { id: 'demo-06', service: 'Barba', branch: 'Sucursal Norte', staff: 'luis@tenant-a.dev', client: 'julian.c@example.com', status: 'PENDING', startsInMin: 2 * DAY, durationMin: 20, expiresInMin: 9 },
  // NORMAL: confirmed
  { id: 'demo-07', service: 'Corte de cabello', branch: 'Sucursal Centro', staff: 'ana@tenant-a.dev', client: 'valentina.o@example.com', status: 'CONFIRMED', startsInMin: 2 * HOUR, durationMin: 30 },
  { id: 'demo-08', service: 'Tinte', branch: 'Sucursal Centro', staff: 'ana@tenant-a.dev', client: 'daniela.s@example.com', status: 'CONFIRMED', startsInMin: DAY + 4 * HOUR, durationMin: 90 },
  { id: 'demo-09', service: 'Manicure', branch: 'Sucursal Norte', staff: 'luis@tenant-a.dev', client: 'isabela.t@example.com', status: 'CONFIRMED', startsInMin: 3 * DAY, durationMin: 45 },
  // CLOSED: no longer actionable
  { id: 'demo-10', service: 'Corte de cabello', branch: 'Sucursal Norte', staff: 'luis@tenant-a.dev', client: 'santiago.h@example.com', status: 'CANCELLED', startsInMin: DAY, durationMin: 30 },
  { id: 'demo-11', service: 'Barba', branch: 'Sucursal Centro', staff: 'luis@tenant-a.dev', client: 'nicolas.l@example.com', status: 'CANCELLED', startsInMin: -DAY, durationMin: 20 },
  { id: 'demo-12', service: 'Tinte', branch: 'Sucursal Centro', staff: 'ana@tenant-a.dev', client: 'paula.k@example.com', status: 'COMPLETED', startsInMin: -2 * DAY, durationMin: 90 },
  { id: 'demo-13', service: 'Manicure', branch: 'Sucursal Norte', staff: 'ana@tenant-a.dev', client: 'felipe.n@example.com', status: 'COMPLETED', startsInMin: -3 * HOUR, durationMin: 45 },
  { id: 'demo-14', service: 'Corte de cabello', branch: 'Sucursal Centro', staff: 'ana@tenant-a.dev', client: 'maria.j@example.com', status: 'NO_SHOW', startsInMin: -DAY - 5 * HOUR, durationMin: 30 },
  // CLOSED by rule: still CONFIRMED in the DB, but the appointment is over
  // (nothing ever moves it to COMPLETED). See getPriority in alerts.ts.
  { id: 'demo-15', service: 'Barba', branch: 'Sucursal Norte', staff: 'luis@tenant-a.dev', client: 'esteban.f@example.com', status: 'CONFIRMED', startsInMin: -3 * DAY, durationMin: 20 },
];

export function buildDemoBookings(now: Date = new Date()): Booking[] {
  const at = (offsetMin: number) => new Date(now.getTime() + offsetMin * MS_PER_MINUTE).toISOString();

  return FIXTURES.map((f) => {
    // Non-PENDING rows have no hold; any past instant is a valid createdAt.
    const createdAt =
      f.expiresInMin !== undefined
        ? at(f.expiresInMin - PENDING_TTL_MINUTES)
        : at(f.startsInMin - 3 * DAY);

    return {
      id: f.id,
      staffId: `demo-staff-${f.staff}`,
      serviceId: `demo-service-${f.service}`,
      branchId: `demo-branch-${f.branch}`,
      clientId: `demo-client-${f.client}`,
      startTime: at(f.startsInMin),
      endTime: at(f.startsInMin + f.durationMin),
      status: f.status,
      createdAt,
      branch: { name: f.branch },
      service: { name: f.service },
      staff: { user: { email: f.staff } },
      client: { email: f.client },
    };
  });
}
