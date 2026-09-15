import { Module } from '@nestjs/common';
import { BranchSchedulesController } from './branch-schedules.controller';
import { BranchSchedulesService } from './branch-schedules.service';
import { BranchScheduleExceptionsController } from './branch-schedule-exceptions.controller';
import { BranchScheduleExceptionsService } from './branch-schedule-exceptions.service';

@Module({
  controllers: [BranchSchedulesController, BranchScheduleExceptionsController],
  providers: [BranchSchedulesService, BranchScheduleExceptionsService],
})
export class BranchSchedulesModule {}
