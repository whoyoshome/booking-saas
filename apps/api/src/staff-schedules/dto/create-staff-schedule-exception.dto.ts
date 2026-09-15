import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreateStaffScheduleExceptionDto {
  @IsUUID()
  staffId: string;

  // Strict "YYYY-MM-DD" only — deliberately NOT @IsDateString(), which
  // accepts the full ISO-8601 grammar including a datetime with a time
  // zone offset (e.g. "2026-12-25T23:00:00-05:00"). That would not
  // reliably land on the intended calendar day once parsed. See
  // parseCalendarDate() in time.util.ts for the paired fix on the storage
  // side.
  @Matches(DATE_ONLY_PATTERN, { message: 'date must be YYYY-MM-DD format' })
  date: string;

  @IsBoolean()
  isAvailable: boolean;

  // RULE (confirmed before implementation): required when isAvailable is
  // true, forbidden when false. Enforced in
  // StaffScheduleExceptionsService, not here — this is a cross-field rule,
  // and class-validator's @ValidateIf works but produces less readable
  // error messages than an explicit check with a clear BadRequestException
  // message.
  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'startTime must be 24h HH:mm format' })
  startTime?: string;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'endTime must be 24h HH:mm format' })
  endTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
