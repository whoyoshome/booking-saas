import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { BookingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { bookingsCacheKey } from '../availability/availability.service';

const PENDING_TTL_MINUTES = 10;

/**
 * Expires abandoned PENDING bookings (checkout started, never confirmed)
 * so their held slot is released back to the exclusion constraint.
 *
 * DECISION (approved at project start, Fase 3 adjustments): a periodic
 * sweep, not BullMQ. This is a mass "cancel everything older than X"
 * operation identical on every run — it doesn't need per-job scheduling,
 * retries, or backoff, which is what BullMQ is actually for. Adding a
 * queue here would couple the availability of a core booking-integrity
 * mechanism to the availability of Redis, for a job whose entire logic is
 * one SQL UPDATE. BullMQ is the right tool once there's a real per-item
 * async job (e.g. notifications) — not for this.
 *
 * Runs as a system-level operation (app.is_super_admin bypass), same
 * reasoning as AuthService.withSystemContext: this sweep is inherently
 * cross-tenant — it has no single caller's tenant context to run under.
 */
@Injectable()
export class BookingsCleanupService {
  private readonly logger = new Logger(BookingsCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expireStalePendingBookings(): Promise<void> {
    const cutoff = new Date(Date.now() - PENDING_TTL_MINUTES * 60_000);

    // Fase 8: also computes what to invalidate in Redis, inside the same
    // bypass transaction — resolving each affected staff's branch
    // timezone here (not after commit) keeps this a single atomic unit
    // of work, and the cache invalidation itself happens right after,
    // outside the transaction (Redis isn't transactional with Postgres,
    // no point pretending otherwise).
    const invalidations = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_super_admin', 'true', true)`;

      const stale = await tx.booking.findMany({
        where: { status: BookingStatus.PENDING, createdAt: { lt: cutoff } },
        select: { id: true, tenantId: true, staffId: true, startTime: true },
      });

      if (stale.length === 0) return [];

      await tx.booking.updateMany({
        where: { id: { in: stale.map((b) => b.id) } },
        data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
      });

      const distinctStaffIds = [...new Set(stale.map((b) => b.staffId))];
      const staffBranches = await tx.staff.findMany({
        where: { id: { in: distinctStaffIds } },
        include: { branch: true },
      });
      const timezoneByStaffId = new Map(
        staffBranches.map((s) => [s.id, s.branch.timezone]),
      );

      return stale.map((b) => ({
        tenantId: b.tenantId,
        staffId: b.staffId,
        localDate: DateTime.fromJSDate(b.startTime, { zone: 'utc' })
          .setZone(timezoneByStaffId.get(b.staffId) ?? 'UTC')
          .toFormat('yyyy-MM-dd'),
      }));
    });

    for (const inv of invalidations) {
      await this.redis.del(bookingsCacheKey(inv.tenantId, inv.staffId, inv.localDate));
    }

    if (invalidations.length > 0) {
      this.logger.log(`Expired ${invalidations.length} stale PENDING booking(s).`);
    }
  }
}
