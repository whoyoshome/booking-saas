import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthenticatedUser } from './types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import { TenantScoped } from '../common/decorators/tenant-scoped.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  // Stricter than the global default (100/min) — brute-forcing a
  // password is exactly the attack this endpoint is most exposed to.
  // 5 attempts/minute per IP still allows a genuine typo or two without
  // friction, while making a real brute-force attempt impractically slow.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password, dto.tenantSlug);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: AuthenticatedUser) {
    await this.authService.logout(user.id);
  }

  // Proof that the authentication pipeline works: any authenticated user,
  // regardless of role, can view their own identity.
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  // Isolation diagnostics used by e2e (tenant-isolation.e2e-spec). Hidden
  // in production so a live demo JWT cannot enumerate session GUC values.
  @Get('admin-only')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.TENANT_ADMIN)
  adminOnly(@CurrentUser() user: AuthenticatedUser) {
    this.assertDiagnosticsEnabled();
    return {
      message: 'RBAC pipeline is wired.',
      requestedBy: user,
    };
  }

  @Get('tenant-context')
  @TenantScoped()
  tenantContext(@CurrentUser() user: AuthenticatedUser) {
    this.assertDiagnosticsEnabled();
    return {
      message: 'TenantGuard passed.',
      user,
    };
  }

  @Get('db-tenant-check')
  @TenantScoped()
  async dbTenantCheck(@CurrentUser() user: AuthenticatedUser) {
    this.assertDiagnosticsEnabled();
    // NULLIF(..., '') is required, not cosmetic: current_setting(name, true)
    // returns '' (empty string), not SQL NULL, when the session variable was
    // never set. Without NULLIF, the JSON response would show "" instead of
    // null for an unset value, which is misleading when comparing against
    // jwtTenantId (which is genuinely null for SUPER_ADMIN).
    const rows = await this.prisma.client.$queryRaw<
      { tenant_id: string | null; is_super_admin: string | null }[]
    >`SELECT
        NULLIF(current_setting('app.current_tenant_id', true), '') as tenant_id,
        NULLIF(current_setting('app.is_super_admin', true), '') as is_super_admin`;

    return {
      jwtTenantId: user.tenantId,
      jwtRole: user.role,
      postgresSessionTenantId: rows[0]?.tenant_id ?? null,
      postgresSessionIsSuperAdmin: rows[0]?.is_super_admin ?? null,
    };
  }

  private assertDiagnosticsEnabled(): void {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }
  }
}
