import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateBranchScheduleDto } from './create-branch-schedule.dto';

// branchId omitted — moving a schedule row to a different branch doesn't
// make sense as an "update"; delete and recreate instead. Same reasoning
// as UpdateStaffScheduleDto.
export class UpdateBranchScheduleDto extends PartialType(
  OmitType(CreateBranchScheduleDto, ['branchId'] as const),
) {}
