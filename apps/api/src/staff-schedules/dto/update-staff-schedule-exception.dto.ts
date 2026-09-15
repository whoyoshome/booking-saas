import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateStaffScheduleExceptionDto } from './create-staff-schedule-exception.dto';

export class UpdateStaffScheduleExceptionDto extends PartialType(
  OmitType(CreateStaffScheduleExceptionDto, ['staffId'] as const),
) {}
