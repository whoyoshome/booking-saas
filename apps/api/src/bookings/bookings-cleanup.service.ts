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
 * A periodic sweep, not BullMQ. This is a mass "cancel everything older than X"
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
    // Also resolves which Redis keys to invalidate, inside the same
    // transaction. The invalidation itself runs after commit, since Redis
    // is not transactional with Postgres.
    const invalidations = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_super_admin', 'true', true)`;

      // ONE conditional UPDATE, not "read the stale ids, then update those
      // ids": a booking confirmed between the read and the write would have
      // been cancelled anyway. Here the status filter is part of the UPDATE
      // itself, so PostgreSQL re-checks it on the row it locks (a booking
      // confirmed concurrently is skipped), and RETURNING yields exactly the
      // rows this sweep cancelled — the only ones whose cache needs
      // invalidating. Prisma 5 has no updateManyAndReturn, hence raw SQL.
      // Timestamps are `timestamp` columns holding UTC, as Prisma writes them.
      const stale = await tx.$queryRaw<
        { id: string; tenantId: string; staffId: string; startTime: Date }[]
      >`
        UPDATE bookings
        SET status = ${BookingStatus.CANCELLED}::"BookingStatus",
            cancelled_at = NOW() AT TIME ZONE 'UTC',
            updated_at = NOW() AT TIME ZONE 'UTC'
        WHERE status = ${BookingStatus.PENDING}::"BookingStatus"
          AND created_at < (NOW() AT TIME ZONE 'UTC') - make_interval(mins => ${PENDING_TTL_MINUTES}::int)
        RETURNING id, tenant_id AS "tenantId", staff_id AS "staffId", start_time AS "startTime"
      `;

      if (stale.length === 0) return [];

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
