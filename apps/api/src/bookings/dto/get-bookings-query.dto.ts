import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { BookingStatus } from '@prisma/client';

export class GetBookingsQueryDto {
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @IsOptional()
  @IsUUID()
  clientId?: string;
}
