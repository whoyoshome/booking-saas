import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { TenantScoped } from '../common/decorators/tenant-scoped.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.type';

@Controller('branches')
@TenantScoped()
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Post()
  @Roles(Role.TENANT_ADMIN)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBranchDto) {
    // TenantGuard + @Roles(TENANT_ADMIN) together already guarantee
    // user.tenantId is set here (TENANT_ADMIN never has a null tenantId).
    // Still checked explicitly rather than asserted with `!` — the
    // codebase's convention throughout has been to treat "should never
    // happen" as worth a real guard, not a type-level promise.
    if (!user.tenantId) {
      throw new ForbiddenException('Missing tenant context.');
    }

    // tenantId comes from the JWT, never from the request body — a
    // TENANT_ADMIN cannot create a branch "for" another tenant, even
    // though the RLS WITH CHECK clause would reject the insert anyway if
    // they tried. This is defense in depth, not the only line of defense.
    return this.branchesService.create(user.tenantId, dto);
  }

  // No @Roles() here — any authenticated, tenant-scoped role (admin,
  // staff, client) can list branches. RolesGuard is a no-op without
  // metadata, so this is intentional, not an oversight.
  @Get()
  findAll() {
    return this.branchesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.branchesService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.TENANT_ADMIN)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto) {
    return this.branchesService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.TENANT_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.branchesService.remove(id);
  }
}
