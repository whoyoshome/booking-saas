import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateStaffDto {
  @IsEmail()
  email: string;

  @IsUUID()
  branchId: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  // Which services this staff member is qualified to perform. Every id
  // here must belong to a service on the SAME branchId — enforced in
  // StaffService (the NestJS service, not the Prisma join table), not by
  // a database constraint, since that check needs data (the service's
  // branchId) that a DB-level CHECK constraint can't easily reach without
  // a trigger — not worth it yet for a rule this simple to check in code.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  serviceIds?: string[];
}
