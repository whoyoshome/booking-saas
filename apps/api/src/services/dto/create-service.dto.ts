import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

export class CreateServiceDto {
  @IsUUID()
  branchId: string;

  @IsString()
  @MinLength(2)
  name: string;

  @IsInt()
  @Min(1)
  durationMinutes: number;

  // Cleanup/prep time after the service, added to the effective booking
  // range so the exclusion constraint blocks it too. Defaults to 0.
  @IsOptional()
  @IsInt()
  @Min(0)
  bufferMinutes?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;
}
