import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { IANAZone } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

/**
 * No separate repository layer here, on purpose — same reasoning already
 * documented in the Phase 0 Technical Plan for simple CRUD modules: a
 * service calling Prisma directly is correct for branches/staff-style
 * entities, and a repository indirection would be an abstraction with no
 * real payoff yet. The one thing that DOES matter here: every query goes
 * through `this.prisma.client`, never `this.prisma` directly — `client` is
 * the getter that resolves to the RLS-scoped transactional connection set
 * up by TenantContextInterceptor (via @TenantScoped() on the controller).
 * Using `this.prisma` directly would silently bypass tenant isolation.
 */
@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  create(tenantId: string, dto: CreateBranchDto) {
    this.assertValidTimezone(dto.timezone);
    return this.prisma.client.branch.create({
      data: {
        tenantId,
        name: dto.name,
        timezone: dto.timezone,
        address: dto.address,
      },
    });
  }

  findAll() {
    // No explicit `where: { tenantId }` here — RLS already scopes this
    // query to the caller's tenant at the database level. Adding a
    // redundant filter wouldn't make this safer (RLS enforces it
    // regardless of what this query says), it would just duplicate a rule
    // that already lives in one place.
    return this.prisma.client.branch.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: string) {
    const branch = await this.prisma.client.branch.findFirst({
      where: { id, deletedAt: null },
    });

    // This is the mechanism, not a special case: if `id` belongs to
    // another tenant, RLS has already made that row invisible to this
    // connection — findFirst returns null exactly as if the row never
    // existed. That's what turns a cross-tenant lookup into a 404
    // automatically, never a 403 that would confirm the resource exists.
    if (!branch) {
      throw new NotFoundException('Branch not found.');
    }

    return branch;
  }

  async update(id: string, dto: UpdateBranchDto) {
    await this.findOne(id); // 404s before attempting the update if not visible
    this.assertValidTimezone(dto.timezone);
    return this.prisma.client.branch.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.client.branch.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // FIX — validated against the real IANA timezone database via Luxon,
  // not just "is this a string". A typo'd zone (e.g. "America/Bogotta")
  // used to be silently accepted and would only fail loudly much later,
  // deep inside AvailabilityService's Luxon calls, with a confusing error
  // far from where the bad data was actually entered. Rejecting it here,
  // at the one place branch.timezone is ever written, is the same
  // principle as validating serviceIds/branchIds at write time instead of
  // discovering the problem at read time.
  private assertValidTimezone(timezone: string | undefined): void {
    if (timezone === undefined) return;
    if (!IANAZone.isValidZone(timezone)) {
      throw new BadRequestException(
        `"${timezone}" is not a valid IANA timezone (e.g. "America/Bogota", "Europe/Madrid").`,
      );
    }
  }
}
