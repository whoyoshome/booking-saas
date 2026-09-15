import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class CreateBookingDto {
  @IsUUID()
  staffId: string;

  @IsUUID()
  serviceId: string;

  // Full UTC instant, ISO-8601 — the exact value the client got back as
  // `startUtc` from a GET /availability slot. endTime is never accepted
  // from the client; it's always derived server-side from
  // service.durationMinutes + service.bufferMinutes, so a booking can
  // never be created with a duration that disagrees with the service
  // definition.
  @IsISO8601()
  startTime: string;

  // Only meaningful when the caller is TENANT_ADMIN/STAFF booking on
  // behalf of someone; ignored (and forced to the caller's own id) when
  // the caller is a CLIENT — see BookingsService.create.
  @IsOptional()
  @IsUUID()
  clientId?: string;
}
