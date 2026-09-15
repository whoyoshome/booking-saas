import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchScheduleDto } from './dto/create-branch-schedule.dto';
import { UpdateBranchScheduleDto } from './dto/update-branch-schedule.dto';
import { formatTimeOfDay, parseTimeOfDay, rangesOverlap } from '../common/util/time.util';

@Injectable()
export class BranchSchedulesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateBranchScheduleDto) {
    await this.assertBranchVisible(dto.branchId);

    const startTime = parseTimeOfDay(dto.startTime);
    const endTime = parseTimeOfDay(dto.endTime);
    this.assertTimeOrder(startTime, endTime);
    await this.assertNoOverlap(dto.branchId, dto.dayOfWeek, startTime, endTime);

    const created = await this.prisma.client.branchSchedule.create({
      data: {
        tenantId,
        branchId: dto.branchId,
        dayOfWeek: dto.dayOfWeek,
        startTime,
        endTime,
      },
    });

    return this.serialize(created);
  }

  async findAll(branchId?: string) {
    const rows = await this.prisma.client.branchSchedule.findMany({
      where: branchId ? { branchId } : {},
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return rows.map((row) => this.serialize(row));
  }

  async findOne(id: string) {
    const row = await this.prisma.client.branchSchedule.findFirst({ where: { id } });
    if (!row) {
      throw new NotFoundException('Branch schedule not found.');
    }
    return this.serialize(row);
  }

  async update(id: string, dto: UpdateBranchScheduleDto) {
    const existing = await this.requireRaw(id);

    const dayOfWeek = dto.dayOfWeek ?? existing.dayOfWeek;
    const startTime = dto.startTime ? parseTimeOfDay(dto.startTime) : existing.startTime;
    const endTime = dto.endTime ? parseTimeOfDay(dto.endTime) : existing.endTime;

    this.assertTimeOrder(startTime, endTime);
    await this.assertNoOverlap(existing.branchId, dayOfWeek, startTime, endTime, id);

    const updated = await this.prisma.client.branchSchedule.update({
      where: { id },
      data: { dayOfWeek, startTime, endTime },
    });

    return this.serialize(updated);
  }

  async remove(id: string): Promise<void> {
    await this.requireRaw(id);
    await this.prisma.client.branchSchedule.delete({ where: { id } });
  }

  // --- internal helpers ---

  private async requireRaw(id: string) {
    const row = await this.prisma.client.branchSchedule.findFirst({ where: { id } });
    if (!row) {
      throw new NotFoundException('Branch schedule not found.');
    }
    return row;
  }

  private async assertBranchVisible(branchId: string): Promise<void> {
    const branch = await this.prisma.client.branch.findFirst({
      where: { id: branchId, deletedAt: null },
    });
    if (!branch) {
      throw new NotFoundException('Branch not found.');
    }
  }

  private assertTimeOrder(startTime: Date, endTime: Date): void {
    if (endTime.getTime() <= startTime.getTime()) {
      throw new BadRequestException('endTime must be after startTime.');
    }
  }

  private async assertNoOverlap(
    branchId: string,
    dayOfWeek: number,
    startTime: Date,
    endTime: Date,
    excludeId?: string,
  ): Promise<void> {
    const siblings = await this.prisma.client.branchSchedule.findMany({
      where: {
        branchId,
        dayOfWeek,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });

    const overlaps = siblings.some((s) =>
      rangesOverlap(startTime, endTime, s.startTime, s.endTime),
    );

    if (overlaps) {
      throw new BadRequestException(
        'This time range overlaps with an existing schedule block for the same day.',
      );
    }
  }

  private serialize(row: {
    id: string;
    branchId: string;
    dayOfWeek: number;
    startTime: Date;
    endTime: Date;
  }) {
    return {
      id: row.id,
      branchId: row.branchId,
      dayOfWeek: row.dayOfWeek,
      startTime: formatTimeOfDay(row.startTime),
      endTime: formatTimeOfDay(row.endTime),
    };
  }
}
