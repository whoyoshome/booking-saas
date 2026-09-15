import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { BookingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { GetAvailabilityQueryDto } from './dto/get-availability-query.dto';
import { parseCalendarDate, intersectTimeRanges } from '../common/util/time.util';

const AVAILABILITY_CACHE_TTL_SECONDS = 30;

/**
 * Exported so BookingsService can invalidate the EXACT same key on
 * create/confirm/cancel — one string built in one place, never
 * reconstructed by hand at each call site (a classic source of silent
 * cache-invalidation bugs: two slightly different key formats that never
 * collide).
 */
export function bookingsCacheKey(tenantId: string, staffId: string, date: string): string {
  return `avail:bookings:${tenantId}:${staffId}:${date}`;
}

export interface AvailabilitySlot {
  startUtc: string;
  endUtc: string;
  startLocal: string;
  endLocal: string;
}

interface TimeBlock {
  startTime: Date;
  endTime: Date;
}

/**
 * DESIGN — this now computes REAL booking availability, not just
 * schedule availability: staff schedule ∩ branch schedule, minus any
 * PENDING/CONFIRMED booking already occupying part of that time.
 * A slot returned here is, at the instant of the request, actually
 * bookable — though the exclusion constraint on `bookings` remains the
 * final authority under real concurrency (two requests racing for the
 * same slot are resolved there, not by this read).
 *
 * ALGORITHM, in order:
 *   1. Resolve staff (RLS-scoped) and service (RLS-scoped) — 404 if either
 *      is invisible to the caller's tenant.
 *   2. Confirm the staff is actually qualified for the service (a real
 *      StaffService row exists) — 400 if not.
 *   3. Defense in depth: confirm staff.branchId === service.branchId (a
 *      staff member moved to a different branch after being qualified for
 *      a service could otherwise slip through — see Fase 4's known gap).
 *   4. Resolve the staff's working blocks for the date: an exception
 *      REPLACES the recurring StaffSchedule for that date; otherwise fall
 *      back to StaffSchedule rows for that day of week.
 *   5. Resolve the branch's OPEN blocks for the date the same way, via
 *      BranchSchedule/BranchScheduleException — UNLESS the branch has
 *      never configured any BranchSchedule at all, in which case branch
 *      hours are treated as unrestricted (opt-in, see Fase 5 Step 3
 *      design notes in README.md for why).
 *   6. Intersect the staff blocks against the branch blocks — a slot only
 *      exists where BOTH the staff is scheduled AND the branch is open.
 *   7. Resolve each intersected block against branch.timezone for the
 *      SPECIFIC calendar date requested, using Luxon (the one place
 *      DST-correct UTC conversion happens), then slice into slots of
 *      (service.durationMinutes + service.bufferMinutes).
 *   8. Subtract any PENDING/CONFIRMED booking for this staff member that
 *      overlaps a candidate slot — this is what makes the result real
 *      booking availability now, not just theoretical schedule.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getSlots(
    query: GetAvailabilityQueryDto,
    options: { ignoreBookings?: boolean } = {},
  ) {
    const staff = await this.prisma.client.staff.findFirst({
      where: { id: query.staffId, deletedAt: null },
      include: { branch: true },
    });
    if (!staff) {
      throw new NotFoundException('Staff not found.');
    }

    const service = await this.prisma.client.service.findFirst({
      where: { id: query.serviceId, deletedAt: null },
    });
    if (!service) {
      throw new NotFoundException('Service not found.');
    }

    const qualification = await this.prisma.client.staffService.findUnique({
      where: {
        staffId_serviceId: { staffId: staff.id, serviceId: service.id },
      },
    });
    if (!qualification) {
      throw new BadRequestException(
        'This staff member is not qualified to perform this service.',
      );
    }

    // Defense in depth: StaffService rows are only created when the
    // service belongs to the staff member's branch AT THAT TIME, but a
    // staff member can be moved to a different branch afterward without
    // old StaffService rows being invalidated — a known gap documented in
    // the Fase 4 bitácora. Re-checked here, at read time.
    if (staff.branchId !== service.branchId) {
      throw new BadRequestException(
        "This service does not belong to the staff member's current branch.",
      );
    }

    const dateOnly = parseCalendarDate(query.date);
    const dayOfWeek = this.isoDayOfWeek(dateOnly);

    const staffBlocks = await this.resolveStaffBlocks(staff.id, dateOnly, dayOfWeek);
    if (staffBlocks === null) {
      // Staff exception marked the day fully unavailable.
      // FIX — explicit AvailabilitySlot[] here, not a bare `[]` (which TS
      // infers as `never[]`). With multiple return sites of different
      // literal shapes, that inference could make the whole method's
      // return type a union where `.slots` isn't consistently typed,
      // breaking `.some(slot => slot.startUtc === ...)` at the call site
      // in BookingsService.
      const slots: AvailabilitySlot[] = [];
      return {
        date: query.date,
        staffId: staff.id,
        serviceId: service.id,
        branchScheduleApplied: false,
        slots,
      };
    }

    const branchResolution = await this.resolveBranchBlocks(
      staff.branchId,
      dateOnly,
      dayOfWeek,
    );

    let effectiveBlocks: TimeBlock[];
    if (branchResolution === 'unrestricted') {
      // Branch never configured any BranchSchedule — opt-in design, see
      // README.md Fase 5 Step 3 notes. No restriction applied.
      effectiveBlocks = staffBlocks;
    } else if (branchResolution === 'closed') {
      effectiveBlocks = [];
    } else {
      effectiveBlocks = this.intersectBlocks(staffBlocks, branchResolution);
    }

    const slotMinutes = service.durationMinutes + service.bufferMinutes;
    const zone = staff.branch.timezone;

    const candidateSlots = effectiveBlocks.flatMap((block) =>
      this.sliceBlockIntoSlots(query.date, block.startTime, block.endTime, zone, slotMinutes),
    );

    // FIX — subtract existing PENDING/CONFIRMED bookings for this staff
    // member. Until now this endpoint only reflected the SCHEDULE
    // (staff ∩ branch), never which of those slots were already taken —
    // it was "theoretical" availability. Bookings are looked up for ANY
    // service this staff performs (not just the one requested), because
    // the exclusion constraint blocks on staff_id alone, regardless of
    // which service a booking is for — two different services booked
    // back to back for the same staff member still occupy the same
    // calendar, so the filter has to match that.
    // FIX — Anti-TOCTOU stabilization: when ignoreBookings is true (only
    // BookingsService.create passes this — never the public controller),
    // this returns the pure schedule grid, deterministic and independent
    // of the timing/visibility of any other in-flight transaction. Two
    // simultaneous booking requests both see the SAME grid, both pass
    // this check, and the race is resolved exactly once, at exactly one
    // place: the exclusion constraint. Checking against live bookings
    // here too would make the outcome depend on transaction-visibility
    // timing between the check and the insert — flaky by construction.
    // GET /availability (ignoreBookings defaults to false) still performs
    // the real subtraction below, because a human browsing slots SHOULD
    // see current bookings removed — that read has no correctness
    // requirement under concurrency, only a UX one.
    const dayStartUtc = DateTime.fromObject(
      {
        year: dateOnly.getUTCFullYear(),
        month: dateOnly.getUTCMonth() + 1,
        day: dateOnly.getUTCDate(),
      },
      { zone },
    ).toUTC();
    const dayEndUtc = dayStartUtc.plus({ days: 1 });

    let existingBookings: { startTime: Date; endTime: Date }[] = [];
    if (!options.ignoreBookings) {
      // Cache-aside, keyed by tenant + staff + LOCAL calendar day — NOT by
      // serviceId. The set of booked ranges for a staff member on a given
      // day is independent of which service someone happens to be
      // checking, so one cached entry serves every serviceId query for
      // that staff+day, instead of one cache line per (staff, service,
      // date) combination.
      const cacheKey = bookingsCacheKey(staff.tenantId, staff.id, query.date);
      const cached = await this.redis.getJson<{ startTime: string; endTime: string }[]>(
        cacheKey,
      );

      if (cached) {
        existingBookings = cached.map((b) => ({
          startTime: new Date(b.startTime),
          endTime: new Date(b.endTime),
        }));
      } else {
        existingBookings = await this.prisma.client.booking.findMany({
          where: {
            staffId: staff.id,
            status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
            startTime: { lt: dayEndUtc.toJSDate() },
            endTime: { gt: dayStartUtc.toJSDate() },
          },
          select: { startTime: true, endTime: true },
        });
        // Short TTL — a safety net only. The real consistency mechanism is
        // BookingsService invalidating this exact key on create/confirm/
        // cancel; the TTL just bounds staleness if an invalidation is
        // ever missed (a Redis blip, a future code path that forgets to
        // call it) rather than caching wrong data indefinitely.
        await this.redis.setJson(cacheKey, existingBookings, AVAILABILITY_CACHE_TTL_SECONDS);
      }
    }

    const slots = options.ignoreBookings
      ? candidateSlots
      : candidateSlots.filter((slot) => {
          const slotStart = new Date(slot.startUtc).getTime();
          const slotEnd = new Date(slot.endUtc).getTime();
          return !existingBookings.some(
            (b) => slotStart < b.endTime.getTime() && b.startTime.getTime() < slotEnd,
          );
        });

    return {
      date: query.date,
      staffId: staff.id,
      serviceId: service.id,
      timezone: zone,
      slotMinutes,
      branchScheduleApplied: branchResolution !== 'unrestricted',
      slots,
    };
  }

  /** Returns the staff's working blocks for the date, or null if the day is a full exception day off. */
  private async resolveStaffBlocks(
    staffId: string,
    dateOnly: Date,
    dayOfWeek: number,
  ): Promise<TimeBlock[] | null> {
    const exception = await this.prisma.client.staffScheduleException.findUnique(
      { where: { staffId_date: { staffId, date: dateOnly } } },
    );

    if (exception) {
      if (!exception.isAvailable) {
        return null;
      }
      // isAvailable=true guarantees startTime/endTime are set — enforced
      // at write time by StaffScheduleExceptionsService.
      return [
        { startTime: exception.startTime as Date, endTime: exception.endTime as Date },
      ];
    }

    return this.prisma.client.staffSchedule.findMany({
      where: { staffId, dayOfWeek },
      orderBy: { startTime: 'asc' },
    });
  }

  /**
   * Returns:
   *   - 'unrestricted' if the branch has never configured any
   *     BranchSchedule row (opt-in design — see class-level doc comment).
   *   - 'closed' if the branch is closed this date (exception or no
   *     matching recurring row for this day of week, given the branch HAS
   *     opted in to configuring hours).
   *   - TimeBlock[] of the branch's open blocks otherwise.
   */
  private async resolveBranchBlocks(
    branchId: string,
    dateOnly: Date,
    dayOfWeek: number,
  ): Promise<TimeBlock[] | 'unrestricted' | 'closed'> {
    const exception = await this.prisma.client.branchScheduleException.findUnique(
      { where: { branchId_date: { branchId, date: dateOnly } } },
    );

    if (exception) {
      if (!exception.isOpen) {
        return 'closed';
      }
      return [
        { startTime: exception.startTime as Date, endTime: exception.endTime as Date },
      ];
    }

    const hasAnyBranchSchedule = await this.prisma.client.branchSchedule.count({
      where: { branchId },
    });
    if (hasAnyBranchSchedule === 0) {
      return 'unrestricted';
    }

    const rows = await this.prisma.client.branchSchedule.findMany({
      where: { branchId, dayOfWeek },
      orderBy: { startTime: 'asc' },
    });

    return rows.length > 0 ? rows : 'closed';
  }

  /**
   * Intersects every staff block against every branch block, keeping only
   * the overlapping portions. Delegates to the shared, unit-tested
   * intersectTimeRanges (time.util.ts) instead of reimplementing the same
   * min/max comparison inline — this file used to have its own duplicate
   * copy of this logic; fixed to have exactly one implementation.
   */
  private intersectBlocks(staffBlocks: TimeBlock[], branchBlocks: TimeBlock[]): TimeBlock[] {
    const result: TimeBlock[] = [];

    for (const s of staffBlocks) {
      for (const b of branchBlocks) {
        const overlap = intersectTimeRanges(s.startTime, s.endTime, b.startTime, b.endTime);
        if (overlap) {
          result.push({ startTime: overlap.start, endTime: overlap.end });
        }
      }
    }

    return result;
  }

  /** 1 = Monday ... 7 = Sunday (ISO-8601), matching StaffSchedule.dayOfWeek. */
  private isoDayOfWeek(date: Date): number {
    const jsDay = date.getUTCDay(); // 0=Sunday ... 6=Saturday
    return jsDay === 0 ? 7 : jsDay;
  }

  private sliceBlockIntoSlots(
    dateStr: string,
    blockStart: Date,
    blockEnd: Date,
    zone: string,
    slotMinutes: number,
  ): AvailabilitySlot[] {
    const [year, month, day] = dateStr.split('-').map(Number);

    const startLocal = DateTime.fromObject(
      { year, month, day, hour: blockStart.getUTCHours(), minute: blockStart.getUTCMinutes() },
      { zone },
    );
    const endLocal = DateTime.fromObject(
      { year, month, day, hour: blockEnd.getUTCHours(), minute: blockEnd.getUTCMinutes() },
      { zone },
    );

    const slots: AvailabilitySlot[] = [];
    let cursor = startLocal;

    while (cursor.plus({ minutes: slotMinutes }) <= endLocal) {
      const slotEnd = cursor.plus({ minutes: slotMinutes });
      slots.push({
        startUtc: cursor.toUTC().toISO() as string,
        endUtc: slotEnd.toUTC().toISO() as string,
        startLocal: cursor.toFormat('HH:mm'),
        endLocal: slotEnd.toFormat('HH:mm'),
      });
      cursor = slotEnd;
    }

    return slots;
  }
}
