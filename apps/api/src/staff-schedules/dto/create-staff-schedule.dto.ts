import { IsInt, IsUUID, Matches, Max, Min } from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class CreateStaffScheduleDto {
  @IsUUID()
  staffId: string;

  // ISO-8601: 1 = Monday ... 7 = Sunday.
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek: number;

  @Matches(TIME_PATTERN, { message: 'startTime must be 24h HH:mm format' })
  startTime: string;

  @Matches(TIME_PATTERN, { message: 'endTime must be 24h HH:mm format' })
  endTime: string;
}
