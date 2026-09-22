import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { AiAssistService } from './ai-assist.service';
import { AiAssistDto } from './dto/ai-assist.dto';
import { TenantScoped } from '../common/decorators/tenant-scoped.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('ai')
@TenantScoped()
export class AiController {
  constructor(private readonly aiAssistService: AiAssistService) {}

  // Stricter than the global default (100/60s) and even stricter than
  // login's 5/60s — an LLM call has real per-request cost, unlike almost
  // everything else in this API. TENANT_ADMIN/STAFF only (@Roles), on top
  // of @TenantScoped() already requiring a valid tenant context — a
  // CLIENT can never reach this even before the throttle is checked.
  @Post('assist')
  @Roles(Role.TENANT_ADMIN, Role.STAFF)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  assist(@Body() dto: AiAssistDto) {
    return this.aiAssistService.assist(dto.question);
  }
}
