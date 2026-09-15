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

export class CreateBranchScheduleExceptionDto {
  @IsUUID()
  branchId: string;

  // Strict "YYYY-MM-DD" only — same reasoning as
  // CreateStaffScheduleExceptionDto.date: never @IsDateString(), which
  // would accept a full ISO datetime with an offset.
  @Matches(DATE_ONLY_PATTERN, { message: 'date must be YYYY-MM-DD format' })
  date: string;

  @IsBoolean()
  isOpen: boolean;

  // Required when isOpen is true, forbidden when false — enforced in
  // BranchScheduleExceptionsService, same cross-field validation pattern
  // as StaffScheduleExceptionsService.
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
