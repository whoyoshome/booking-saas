import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingsCleanupService } from './bookings-cleanup.service';
import { AvailabilityModule } from '../availability/availability.module';

@Module({
  imports: [AvailabilityModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingsCleanupService],
})
export class BookingsModule {}
