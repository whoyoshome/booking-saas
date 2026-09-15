import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';

// Deliberately NOT PartialType(CreateStaffDto) — email is not something you
// "update" on a staff profile (that's an account-recovery/identity concern,
// out of scope here), and provisioning fields don't apply to an update.
// Only branchId reassignment and the service-qualification list are real
// update operations for this resource.
export class UpdateStaffDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  serviceIds?: string[];
}
