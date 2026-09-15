import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffScheduleDto } from './dto/create-staff-schedule.dto';
import { UpdateStaffScheduleDto } from './dto/update-staff-schedule.dto';
import { formatTimeOfDay, parseTimeOfDay, rangesOverlap } from '../common/util/time.util';

@Injectable()
export class StaffSchedulesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateStaffScheduleDto) {
    await this.assertStaffVisible(dto.staffId);

    const startTime = parseTimeOfDay(dto.startTime);
    const endTime = parseTimeOfDay(dto.endTime);
    this.assertTimeOrder(startTime, endTime);
    await this.assertNoOverlap(dto.staffId, dto.dayOfWeek, startTime, endTime);

    const created = await this.prisma.client.staffSchedule.create({
      data: {
        tenantId,
        staffId: dto.staffId,
        dayOfWeek: dto.dayOfWeek,
        startTime,
        endTime,
      },
    });

    return this.serialize(created);
  }

  async findAll(staffId?: string) {
    const rows = await this.prisma.client.staffSchedule.findMany({
      where: staffId ? { staffId } : {},
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return rows.map((row) => this.serialize(row));
  }

  async findOne(id: string) {
    const row = await this.prisma.client.staffSchedule.findFirst({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException('Staff schedule not found.');
    }
    return this.serialize(row);
  }

  async update(id: string, dto: UpdateStaffScheduleDto) {
    const existing = await this.requireRaw(id);

    const dayOfWeek = dto.dayOfWeek ?? existing.dayOfWeek;
    const startTime = dto.startTime ? parseTimeOfDay(dto.startTime) : existing.startTime;
    const endTime = dto.endTime ? parseTimeOfDay(dto.endTime) : existing.endTime;

    this.assertTimeOrder(startTime, endTime);
    await this.assertNoOverlap(existing.staffId, dayOfWeek, startTime, endTime, id);

    const updated = await this.prisma.client.staffSchedule.update({
      where: { id },
      data: { dayOfWeek, startTime, endTime },
    });

    return this.serialize(updated);
  }

  async remove(id: string): Promise<void> {
    await this.requireRaw(id);
    await this.prisma.client.staffSchedule.delete({ where: { id } });
  }

  // --- internal helpers ---

  private async requireRaw(id: string) {
    const row = await this.prisma.client.staffSchedule.findFirst({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException('Staff schedule not found.');
    }
    return row;
  }

  private async assertStaffVisible(staffId: string): Promise<void> {
    const staff = await this.prisma.client.staff.findFirst({
      where: { id: staffId, deletedAt: null },
    });
    if (!staff) {
      throw new NotFoundException('Staff not found.');
    }
  }

  private assertTimeOrder(startTime: Date, endTime: Date): void {
    // No overnight spans in v1, confirmed before implementation — endTime
    // must be strictly after startTime within the same calendar day.
    if (endTime.getTime() <= startTime.getTime()) {
      throw new BadRequestException('endTime must be after startTime.');
    }
  }

  private async assertNoOverlap(
    staffId: string,
    dayOfWeek: number,
    startTime: Date,
    endTime: Date,
    excludeId?: string,
  ): Promise<void> {
    const siblings = await this.prisma.client.staffSchedule.findMany({
      where: {
        staffId,
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
    staffId: string;
    dayOfWeek: number;
    startTime: Date;
    endTime: Date;
  }) {
    return {
      id: row.id,
      staffId: row.staffId,
      dayOfWeek: row.dayOfWeek,
      startTime: formatTimeOfDay(row.startTime),
      endTime: formatTimeOfDay(row.endTime),
    };
  }
}
