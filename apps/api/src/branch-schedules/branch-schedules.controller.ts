import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { BranchSchedulesService } from './branch-schedules.service';
import { CreateBranchScheduleDto } from './dto/create-branch-schedule.dto';
import { UpdateBranchScheduleDto } from './dto/update-branch-schedule.dto';
import { TenantScoped } from '../common/decorators/tenant-scoped.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.type';

@Controller('branch-schedules')
@TenantScoped()
export class BranchSchedulesController {
  constructor(private readonly branchSchedulesService: BranchSchedulesService) {}

  @Post()
  @Roles(Role.TENANT_ADMIN)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBranchScheduleDto,
  ) {
    if (!user.tenantId) {
      throw new ForbiddenException('Missing tenant context.');
    }
    return this.branchSchedulesService.create(user.tenantId, dto);
  }

  @Get()
  findAll(@Query('branchId') branchId?: string) {
    return this.branchSchedulesService.findAll(branchId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.branchSchedulesService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.TENANT_ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateBranchScheduleDto) {
    return this.branchSchedulesService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.TENANT_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    await this.branchSchedulesService.remove(id);
  }
}
