import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateBranchScheduleExceptionDto } from './create-branch-schedule-exception.dto';

export class UpdateBranchScheduleExceptionDto extends PartialType(
  OmitType(CreateBranchScheduleExceptionDto, ['branchId'] as const),
) {}
