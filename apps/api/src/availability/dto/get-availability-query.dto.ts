import { IsUUID, Matches } from 'class-validator';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class GetAvailabilityQueryDto {
  @IsUUID()
  staffId: string;

  @IsUUID()
  serviceId: string;

  // Strict "YYYY-MM-DD" — same reasoning as StaffScheduleException.date:
  // never accept a full ISO datetime that could carry an offset and shift
  // which calendar day is actually intended.
  @Matches(DATE_ONLY_PATTERN, { message: 'date must be YYYY-MM-DD format' })
  date: string;
}
