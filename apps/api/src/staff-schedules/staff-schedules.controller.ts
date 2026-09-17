import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { StaffSchedulesService } from './staff-schedules.service';
import { CreateStaffScheduleDto } from './dto/create-staff-schedule.dto';
import { UpdateStaffScheduleDto } from './dto/update-staff-schedule.dto';
import { TenantScoped } from '../common/decorators/tenant-scoped.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.type';

@Controller('staff-schedules')
@TenantScoped()
export class StaffSchedulesController {
  constructor(private readonly staffSchedulesService: StaffSchedulesService) {}

  @Post()
  @Roles(Role.TENANT_ADMIN)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateStaffScheduleDto,
  ) {
    if (!user.tenantId) {
      throw new ForbiddenException('Missing tenant context.');
    }
    return this.staffSchedulesService.create(user.tenantId, dto);
  }

  @Get()
  findAll(
    @Query('staffId', new ParseUUIDPipe({ optional: true })) staffId?: string,
  ) {
    return this.staffSchedulesService.findAll(staffId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.staffSchedulesService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.TENANT_ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffScheduleDto,
  ) {
    return this.staffSchedulesService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.TENANT_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.staffSchedulesService.remove(id);
  }
}
