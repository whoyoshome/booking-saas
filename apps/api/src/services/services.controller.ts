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
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { TenantScoped } from '../common/decorators/tenant-scoped.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.type';

@Controller('services')
@TenantScoped()
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  @Roles(Role.TENANT_ADMIN)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateServiceDto,
  ) {
    if (!user.tenantId) {
      throw new ForbiddenException('Missing tenant context.');
    }
    return this.servicesService.create(user.tenantId, dto);
  }

  // ?branchId=<uuid> filters to one branch's service menu; omitted, returns
  // the tenant's full catalog across all its branches. No @Roles() — any
  // authenticated tenant-scoped role can browse services (a client picking
  // a service to book needs this).
  @Get()
  findAll(
    @Query('branchId', new ParseUUIDPipe({ optional: true })) branchId?: string,
  ) {
    return this.servicesService.findAll(branchId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicesService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.TENANT_ADMIN)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateServiceDto) {
    return this.servicesService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.TENANT_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.servicesService.remove(id);
  }
}
