import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateStaffDto) {
    const branch = await this.prisma.client.branch.findFirst({
      where: { id: dto.branchId, deletedAt: null },
    });
    if (!branch) {
      throw new NotFoundException('Branch not found.');
    }

    const serviceIds = dto.serviceIds ?? [];
    await this.validateServicesBelongToBranch(dto.branchId, serviceIds);

    // Temporary credential, shown exactly once in the response — there is
    // no invite/magic-link flow yet (Phase 17 of the general roadmap,
    // Notifications). See the schema.prisma comment on Staff for the full
    // rationale.
    const temporaryPassword = randomBytes(9).toString('base64url');
    const passwordHash = await argon2.hash(temporaryPassword, {
      type: argon2.argon2id,
    });

    // No explicit $transaction wrapper here: this method already runs
    // inside the transaction TenantContextInterceptor opened for the
    // request (that's what this.prisma.client resolves to). If the
    // StaffService (Nest) create fails partway through, the whole thing
    // rolls back along with it — atomicity comes from the architecture,
    // not from an extra transaction nested inside this method.
    let user;
    try {
      user = await this.prisma.client.user.create({
        data: {
          tenantId,
          email: dto.email,
          passwordHash,
          role: Role.STAFF,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'A user with this email already exists for this tenant.',
        );
      }
      throw err;
    }

    const staff = await this.prisma.client.staff.create({
      data: {
        tenantId,
        branchId: dto.branchId,
        userId: user.id,
      },
    });

    if (serviceIds.length > 0) {
      await this.prisma.client.staffService.createMany({
        data: serviceIds.map((serviceId) => ({
          tenantId,
          staffId: staff.id,
          serviceId,
        })),
      });
    }

    return {
      ...staff,
      user: { id: user.id, email: user.email },
      temporaryPassword,
    };
  }

  findAll(branchId?: string) {
    return this.prisma.client.staff.findMany({
      where: {
        deletedAt: null,
        ...(branchId ? { branchId } : {}),
      },
      include: {
        user: { select: { id: true, email: true } },
        services: { include: { service: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: string) {
    const staff = await this.prisma.client.staff.findFirst({
      where: { id, deletedAt: null },
      include: {
        user: { select: { id: true, email: true } },
        services: { include: { service: { select: { id: true, name: true } } } },
      },
    });

    if (!staff) {
      throw new NotFoundException('Staff not found.');
    }

    return staff;
  }

  async update(id: string, dto: UpdateStaffDto) {
    const staff = await this.findOne(id); // 404s before anything else if not visible

    const targetBranchId = dto.branchId ?? staff.branchId;

    if (dto.branchId) {
      const branch = await this.prisma.client.branch.findFirst({
        where: { id: dto.branchId, deletedAt: null },
      });
      if (!branch) {
        throw new NotFoundException('Branch not found.');
      }
    }

    if (dto.serviceIds) {
      await this.validateServicesBelongToBranch(targetBranchId, dto.serviceIds);
    }

    await this.prisma.client.staff.update({
      where: { id },
      data: dto.branchId ? { branchId: dto.branchId } : {},
    });

    if (dto.serviceIds) {
      // Full replace, not incremental add/remove — a simpler mental model
      // for an admin UI ("here is the new complete list"), at the cost of
      // losing a diff of what changed. Revisit if the UI ever needs
      // granular add/remove instead of "set the whole list".
      await this.prisma.client.staffService.deleteMany({
        where: { staffId: id },
      });
      if (dto.serviceIds.length > 0) {
        await this.prisma.client.staffService.createMany({
          data: dto.serviceIds.map((serviceId) => ({
            tenantId: staff.tenantId,
            staffId: id,
            serviceId,
          })),
        });
      }
    }

    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    // KNOWN GAP, stated plainly: this soft-deletes the Staff profile but
    // does NOT currently revoke the underlying User's ability to log in —
    // there is no `isActive`/`suspended` flag on User yet. A "removed"
    // staff member's account still authenticates successfully; they'd just
    // no longer appear in staff listings. Flagged for Fase 13 of the
    // general roadmap (Production hardening), not silently shipped as if
    // it were already handled.
    await this.prisma.client.staff.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private async validateServicesBelongToBranch(
    branchId: string,
    serviceIds: string[],
  ): Promise<void> {
    if (serviceIds.length === 0) return;

    const found = await this.prisma.client.service.findMany({
      where: { id: { in: serviceIds }, branchId, deletedAt: null },
      select: { id: true },
    });

    // One generic message whether a serviceId doesn't exist at all, exists
    // but on a different branch, or exists but belongs to another tenant
    // (RLS already hid it, so it looks identical to "doesn't exist" from
    // here) — no distinction leaks which of those is actually true.
    if (found.length !== serviceIds.length) {
      throw new BadRequestException(
        'One or more serviceIds do not exist or do not belong to the selected branch.',
      );
    }
  }
}
