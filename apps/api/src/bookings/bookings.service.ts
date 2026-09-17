import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { Role, BookingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AvailabilityService, bookingsCacheKey } from '../availability/availability.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { AuthenticatedUser } from '../auth/types/jwt-payload.type';

const NO_DOUBLE_BOOKING_CONSTRAINT = 'bookings_no_double_booking';
const TIME_ORDER_CONSTRAINT = 'bookings_time_order';

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availabilityService: AvailabilityService,
    private readonly redis: RedisService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateBookingDto) {
    if (!user.tenantId) {
      throw new ForbiddenException('Missing tenant context.');
    }

    const clientId = user.role === Role.CLIENT ? user.id : dto.clientId ?? user.id;

    const staff = await this.prisma.client.staff.findFirst({
      where: { id: dto.staffId, deletedAt: null },
      include: { branch: true },
    });
    if (!staff) {
      throw new NotFoundException('Staff not found.');
    }

    const service = await this.prisma.client.service.findFirst({
      where: { id: dto.serviceId, deletedAt: null },
    });
    if (!service) {
      throw new NotFoundException('Service not found.');
    }

    if (staff.branchId !== service.branchId) {
      throw new BadRequestException(
        "This service does not belong to the staff member's current branch.",
      );
    }

    const qualification = await this.prisma.client.staffService.findUnique({
      where: { staffId_serviceId: { staffId: staff.id, serviceId: service.id } },
    });
    if (!qualification) {
      throw new BadRequestException(
        'This staff member is not qualified to perform this service.',
      );
    }

    const startTime = new Date(dto.startTime);
    if (Number.isNaN(startTime.getTime())) {
      throw new BadRequestException('startTime must be a valid ISO-8601 datetime.');
    }

    // Validates the requested slot against the SCHEDULE grid only
    // (staff ∩ branch, service duration+buffer) — deliberately with
    // ignoreBookings: true. This check exists to reject an obviously
    // wrong request (a time never offered by any schedule at all) with a
    // clean 400, not to detect double-booking. Detecting whether the slot
    // is already taken is intentionally NOT done here — that's the
    // exclusion constraint's job, below, and only there: checking live
    // bookings in this pre-check too would make the outcome depend on
    // transaction-visibility timing between this check and the insert,
    // producing flaky results under real concurrency instead of the
    // deterministic 201/409 split the whole project is built around.
    const localDate = DateTime.fromJSDate(startTime, { zone: 'utc' })
      .setZone(staff.branch.timezone)
      .toFormat('yyyy-MM-dd');

    const availability = await this.availabilityService.getSlots(
      { staffId: staff.id, serviceId: service.id, date: localDate },
      { ignoreBookings: true },
    );

    const requestedIso = startTime.toISOString();
    const matchesAnAvailableSlot = availability.slots.some(
      (slot) => slot.startUtc === requestedIso,
    );
    if (!matchesAnAvailableSlot) {
      throw new BadRequestException(
        'The requested startTime does not match an available slot for this staff member and service.',
      );
    }

    const slotMinutes = service.durationMinutes + service.bufferMinutes;
    const endTime = new Date(startTime.getTime() + slotMinutes * 60_000);

    try {
      const booking = await this.prisma.client.booking.create({
        data: {
          tenantId: user.tenantId,
          branchId: staff.branchId,
          staffId: staff.id,
          serviceId: service.id,
          clientId,
          startTime,
          endTime,
          status: BookingStatus.PENDING,
        },
      });
      // Invalidate immediately — don't wait for the 30s TTL. A booking
      // was just created for this staff+day; the cached "existing
      // bookings" list is now stale the instant this transaction commits.
      await this.redis.del(bookingsCacheKey(user.tenantId, staff.id, localDate));
      return booking;
    } catch (err) {
      throw this.translateDatabaseError(err);
    }
  }

  async findAll(
    user: AuthenticatedUser,
    filters: { staffId?: string; status?: BookingStatus; clientId?: string },
  ) {
    // FIX — a CLIENT must only ever see their own bookings. RLS scopes
    // this query to the tenant, not to the individual client, so without
    // this override a CLIENT calling GET /bookings would see every
    // client's bookings in the tenant. A CLIENT-supplied clientId filter
    // is ignored, not merely validated — same pattern as the clientId
    // override in create().
    const clientId = user.role === Role.CLIENT ? user.id : filters.clientId;

    return this.prisma.client.booking.findMany({
      where: {
        ...(filters.staffId ? { staffId: filters.staffId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(clientId ? { clientId } : {}),
      },
      // Fase 12 (UX): the web app needs names to display, not raw UUIDs.
      // Purely additive — every scalar field already returned (id, status,
      // startTime, endTime, branchId, staffId, serviceId, clientId) is
      // still present; `include` only adds nested objects alongside them.
      // No schema/RLS change, no new endpoint — same GET /bookings that
      // already existed, same tenant-scoped query underneath.
      include: {
        branch: { select: { name: true } },
        service: { select: { name: true } },
        staff: { include: { user: { select: { email: true } } } },
        client: { select: { email: true } },
      },
      orderBy: { startTime: 'asc' },
    });
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const booking = await this.prisma.client.booking.findFirst({ where: { id } });
    if (!booking || (user.role === Role.CLIENT && booking.clientId !== user.id)) {
      throw new NotFoundException('Booking not found.');
    }
    return booking;
  }

  async confirm(id: string) {
    const booking = await this.prisma.client.booking.findFirst({ where: { id } });
    if (!booking) {
      throw new NotFoundException('Booking not found.');
    }
    if (booking.status !== BookingStatus.PENDING) {
      throw new BadRequestException(
        `Cannot confirm a booking in status ${booking.status}.`,
      );
    }
    const updated = await this.prisma.client.booking.update({
      where: { id },
      data: { status: BookingStatus.CONFIRMED },
    });
    // Status didn't change what's occupied (PENDING already counted), but
    // invalidate anyway — cheap, and removes any doubt if that ever
    // changes (e.g. a future decision to only cache-count CONFIRMED).
    await this.invalidateAvailabilityCache(updated.tenantId, updated.staffId, updated.startTime);
    return updated;
  }

  async cancel(id: string, user: AuthenticatedUser) {
    const booking = await this.prisma.client.booking.findFirst({ where: { id } });
    if (!booking || (user.role === Role.CLIENT && booking.clientId !== user.id)) {
      throw new NotFoundException('Booking not found.');
    }

    if (
      booking.status === BookingStatus.CANCELLED ||
      booking.status === BookingStatus.COMPLETED
    ) {
      throw new BadRequestException(
        `Cannot cancel a booking in status ${booking.status}.`,
      );
    }

    const updated = await this.prisma.client.booking.update({
      where: { id },
      data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
    });
    // This one matters most: cancelling FREES a slot. Without this
    // invalidation, GET /availability would keep hiding that slot for up
    // to 30s (the TTL) after it's actually bookable again.
    await this.invalidateAvailabilityCache(updated.tenantId, updated.staffId, updated.startTime);
    return updated;
  }

  private async invalidateAvailabilityCache(
    tenantId: string,
    staffId: string,
    startTime: Date,
  ): Promise<void> {
    const staff = await this.prisma.client.staff.findFirst({
      where: { id: staffId },
      include: { branch: true },
    });
    if (!staff) return; // shouldn't happen — booking always references a real staff

    const localDate = DateTime.fromJSDate(startTime, { zone: 'utc' })
      .setZone(staff.branch.timezone)
      .toFormat('yyyy-MM-dd');

    await this.redis.del(bookingsCacheKey(tenantId, staffId, localDate));
  }

  private translateDatabaseError(err: unknown): Error {
    // FIX — PostgreSQL raises SQLSTATE 23P01 (exclusion_violation) for
    // bookings_no_double_booking. Prisma does NOT map this to P2004 (or
    // any of its own P-codes) for a constraint it doesn't specifically
    // recognize — it surfaces as PrismaClientUnknownRequestError, with the
    // raw driver error text (constraint name + SQLSTATE) embedded in
    // .message, not in a structured .code we can switch on. Detecting by
    // constraint NAME is more precise than by SQLSTATE alone, since
    // 23P01 is generic to every exclusion constraint, not just this one.
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes(NO_DOUBLE_BOOKING_CONSTRAINT) || message.includes('23P01')) {
      return new ConflictException(
        'This time slot is no longer available for this staff member.',
      );
    }

    if (message.includes(TIME_ORDER_CONSTRAINT)) {
      return new BadRequestException('endTime must be after startTime.');
    }

    return err as Error;
  }
}
