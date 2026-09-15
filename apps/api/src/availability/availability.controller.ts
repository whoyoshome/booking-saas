import { Controller, Get, Query } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { GetAvailabilityQueryDto } from './dto/get-availability-query.dto';
import { TenantScoped } from '../common/decorators/tenant-scoped.decorator';

// No @Roles() on the GET handler — any authenticated tenant-scoped role
// (admin, staff, client) can check availability. A client picking a time
// to book needs this exactly as much as an admin reviewing a schedule
// does.
@Controller('availability')
@TenantScoped()
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get()
  getSlots(@Query() query: GetAvailabilityQueryDto) {
    return this.availabilityService.getSlots(query);
  }
}
