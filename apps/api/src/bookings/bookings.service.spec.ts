import { BadRequestException, ConflictException } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { RedisService } from '../redis/redis.service';

/**
 * Unit tests translateDatabaseError() in isolation — the constructor's
 * real dependencies (PrismaService, AvailabilityService, RedisService)
 * are irrelevant to this method, so they're passed as empty mocks rather
 * than bootstrapping a full Nest testing module. translateDatabaseError
 * is private; accessed here via bracket notation, a standard, accepted
 * pattern for unit-testing private logic without changing its visibility
 * just to make it testable.
 *
 * This exists specifically as a regression test for the Fase 6/8 bug:
 * Prisma does NOT surface the exclusion constraint violation as P2004 —
 * it comes through as PrismaClientUnknownRequestError with the raw
 * driver text (SQLSTATE + constraint name) in .message. A future refactor
 * that reverts to checking err.code would silently break 409 handling
 * without any e2e test catching it under normal (non-racing) conditions.
 */
describe('BookingsService.translateDatabaseError', () => {
  let service: BookingsService;

  beforeEach(() => {
    service = new BookingsService(
      {} as PrismaService,
      {} as AvailabilityService,
      {} as RedisService,
    );
  });

  function translate(err: unknown): Error {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (service as any).translateDatabaseError(err);
  }

  it('maps the exclusion constraint violation (by name) to 409 Conflict', () => {
    const err = new Error(
      'insert or update on table "bookings" violates exclusion constraint "bookings_no_double_booking"',
    );
    expect(translate(err)).toBeInstanceOf(ConflictException);
  });

  it('maps a raw SQLSTATE 23P01 to 409 Conflict even without the constraint name in the message', () => {
    const err = new Error('ERROR: conflicting key value violates exclusion constraint, code 23P01');
    expect(translate(err)).toBeInstanceOf(ConflictException);
  });

  it('maps the time-order CHECK violation to 400 Bad Request', () => {
    const err = new Error(
      'new row for relation "bookings" violates check constraint "bookings_time_order"',
    );
    expect(translate(err)).toBeInstanceOf(BadRequestException);
  });

  it('passes an unrecognized error through unchanged, not swallowed as a generic 500', () => {
    const err = new Error('connection terminated unexpectedly');
    expect(translate(err)).toBe(err);
  });

  it('handles a non-Error thrown value without crashing', () => {
    expect(() => translate('a plain string was thrown')).not.toThrow();
  });
});
