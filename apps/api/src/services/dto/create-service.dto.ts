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
  // range in Phase 6 (general roadmap) so the exclusion constraint blocks
  // it automatically. Defaults to 0 — most services don't need it, and an
  // explicit opt-in is safer than guessing a default that changes booking
  // behavior silently.
  @IsOptional()
  @IsInt()
  @Min(0)
  bufferMinutes?: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;
}
