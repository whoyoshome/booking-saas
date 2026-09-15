import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateStaffScheduleDto } from './create-staff-schedule.dto';

// staffId omitted on purpose — moving a schedule row to a different staff
// member doesn't make sense as an "update"; delete and recreate instead.
export class UpdateStaffScheduleDto extends PartialType(
  OmitType(CreateStaffScheduleDto, ['staffId'] as const),
) {}
