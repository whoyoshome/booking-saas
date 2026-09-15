import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateBranchDto {
  @IsString()
  @MinLength(2)
  name: string;

  // Format-only check here (it's a string). Real IANA validity is checked
  // in BranchesService.assertValidTimezone via Luxon's zone database — see
  // that method's comment for why it lives there and not here.
  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  address?: string;
}
