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
import { StaffScheduleExceptionsService } from './staff-schedule-exceptions.service';
import { CreateStaffScheduleExceptionDto } from './dto/create-staff-schedule-exception.dto';
import { UpdateStaffScheduleExceptionDto } from './dto/update-staff-schedule-exception.dto';
import { TenantScoped } from '../common/decorators/tenant-scoped.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.type';

@Controller('staff-schedule-exceptions')
@TenantScoped()
export class StaffScheduleExceptionsController {
  constructor(
    private readonly exceptionsService: StaffScheduleExceptionsService,
  ) {}

  @Post()
  @Roles(Role.TENANT_ADMIN)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateStaffScheduleExceptionDto,
  ) {
    if (!user.tenantId) {
      throw new ForbiddenException('Missing tenant context.');
    }
    return this.exceptionsService.create(user.tenantId, dto);
  }

  @Get()
  findAll(
    @Query('staffId', new ParseUUIDPipe({ optional: true })) staffId?: string,
  ) {
    return this.exceptionsService.findAll(staffId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.exceptionsService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.TENANT_ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffScheduleExceptionDto,
  ) {
    return this.exceptionsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.TENANT_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.exceptionsService.remove(id);
  }
}
