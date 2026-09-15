import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateServiceDto) {
    // Confirms the branch exists AND is visible to this tenant, reusing the
    // exact same mechanism as BranchesService.findOne — RLS already scoped
    // this query to the caller's tenant, so a branchId belonging to another
    // tenant is invisible here, not something we compare tenantId against
    // by hand. One 404 branch for "doesn't exist" and "belongs to someone
    // else" is intentional (see the Fase 3 note on not leaking existence).
    const branch = await this.prisma.client.branch.findFirst({
      where: { id: dto.branchId, deletedAt: null },
    });
    if (!branch) {
      throw new NotFoundException('Branch not found.');
    }

    return this.prisma.client.service.create({
      data: {
        tenantId,
        branchId: dto.branchId,
        name: dto.name,
        durationMinutes: dto.durationMinutes,
        bufferMinutes: dto.bufferMinutes ?? 0,
        price: dto.price,
      },
    });
  }

  findAll(branchId?: string) {
    return this.prisma.client.service.findMany({
      where: {
        deletedAt: null,
        ...(branchId ? { branchId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: string) {
    const service = await this.prisma.client.service.findFirst({
      where: { id, deletedAt: null },
    });

    if (!service) {
      throw new NotFoundException('Service not found.');
    }

    return service;
  }

  async update(id: string, dto: UpdateServiceDto) {
    await this.findOne(id); // 404s before attempting the update if not visible

    // If the caller is trying to move the service to a different branch,
    // re-validate that branch the same way create() does — moving a
    // service to a branch you can't see should fail exactly like creating
    // one there would.
    if (dto.branchId) {
      const branch = await this.prisma.client.branch.findFirst({
        where: { id: dto.branchId, deletedAt: null },
      });
      if (!branch) {
        throw new NotFoundException('Branch not found.');
      }
    }

    return this.prisma.client.service.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.client.service.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
