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
import { BranchScheduleExceptionsService } from './branch-schedule-exceptions.service';
import { CreateBranchScheduleExceptionDto } from './dto/create-branch-schedule-exception.dto';
import { UpdateBranchScheduleExceptionDto } from './dto/update-branch-schedule-exception.dto';
import { TenantScoped } from '../common/decorators/tenant-scoped.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.type';

@Controller('branch-schedule-exceptions')
@TenantScoped()
export class BranchScheduleExceptionsController {
  constructor(
    private readonly exceptionsService: BranchScheduleExceptionsService,
  ) {}

  @Post()
  @Roles(Role.TENANT_ADMIN)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBranchScheduleExceptionDto,
  ) {
    if (!user.tenantId) {
      throw new ForbiddenException('Missing tenant context.');
    }
    return this.exceptionsService.create(user.tenantId, dto);
  }

  @Get()
  findAll(
    @Query('branchId', new ParseUUIDPipe({ optional: true })) branchId?: string,
  ) {
    return this.exceptionsService.findAll(branchId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.exceptionsService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.TENANT_ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchScheduleExceptionDto,
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
