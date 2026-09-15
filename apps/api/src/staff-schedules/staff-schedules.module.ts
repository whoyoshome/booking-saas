import { Module } from '@nestjs/common';
import { StaffSchedulesController } from './staff-schedules.controller';
import { StaffSchedulesService } from './staff-schedules.service';
import { StaffScheduleExceptionsController } from './staff-schedule-exceptions.controller';
import { StaffScheduleExceptionsService } from './staff-schedule-exceptions.service';

@Module({
  controllers: [StaffSchedulesController, StaffScheduleExceptionsController],
  providers: [StaffSchedulesService, StaffScheduleExceptionsService],
})
export class StaffSchedulesModule {}
