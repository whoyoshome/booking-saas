import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchScheduleExceptionDto } from './dto/create-branch-schedule-exception.dto';
import { UpdateBranchScheduleExceptionDto } from './dto/update-branch-schedule-exception.dto';
import {
  formatCalendarDate,
  formatTimeOfDay,
  parseCalendarDate,
  parseTimeOfDay,
} from '../common/util/time.util';

@Injectable()
export class BranchScheduleExceptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateBranchScheduleExceptionDto) {
    await this.assertBranchVisible(dto.branchId);

    const { startTime, endTime } = this.resolveAndValidateTimes(dto);

    try {
      const created = await this.prisma.client.branchScheduleException.create({
        data: {
          tenantId,
          branchId: dto.branchId,
          date: parseCalendarDate(dto.date),
          isOpen: dto.isOpen,
          startTime,
          endTime,
          reason: dto.reason,
        },
      });
      return this.serialize(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'An exception already exists for this branch on this date.',
        );
      }
      throw err;
    }
  }

  async findAll(branchId?: string) {
    const rows = await this.prisma.client.branchScheduleException.findMany({
      where: branchId ? { branchId } : {},
      orderBy: { date: 'asc' },
    });
    return rows.map((row) => this.serialize(row));
  }

  async findOne(id: string) {
    const row = await this.prisma.client.branchScheduleException.findFirst({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException('Branch schedule exception not found.');
    }
    return this.serialize(row);
  }

  async update(id: string, dto: UpdateBranchScheduleExceptionDto) {
    const existing = await this.requireRaw(id);

    const touchesAvailability = dto.isOpen !== undefined;
    const touchesTimes = dto.startTime !== undefined || dto.endTime !== undefined;
    const isOpen = dto.isOpen ?? existing.isOpen;

    let startTime = existing.startTime;
    let endTime = existing.endTime;

    // Same fix already applied to StaffScheduleExceptionsService.update:
    // only re-validate when isOpen/times are actually touched, resolved
    // against the EXISTING values, not just whatever the DTO happened to
    // include.
    if (touchesAvailability || touchesTimes) {
      const resolved = this.resolveAndValidateTimes({
        isOpen,
        startTime: dto.startTime ?? (existing.startTime ? formatTimeOfDay(existing.startTime) : undefined),
        endTime: dto.endTime ?? (existing.endTime ? formatTimeOfDay(existing.endTime) : undefined),
      });
      startTime = resolved.startTime;
      endTime = resolved.endTime;
    }

    const updated = await this.prisma.client.branchScheduleException.update({
      where: { id },
      data: {
        date: dto.date ? parseCalendarDate(dto.date) : undefined,
        isOpen,
        startTime,
        endTime,
        reason: dto.reason,
      },
    });

    return this.serialize(updated);
  }

  async remove(id: string): Promise<void> {
    await this.requireRaw(id);
    await this.prisma.client.branchScheduleException.delete({ where: { id } });
  }

  // --- internal helpers ---

  private async requireRaw(id: string) {
    const row = await this.prisma.client.branchScheduleException.findFirst({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException('Branch schedule exception not found.');
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

  private resolveAndValidateTimes(dto: {
    isOpen: boolean;
    startTime?: string;
    endTime?: string;
  }): { startTime: Date | null; endTime: Date | null } {
    if (dto.isOpen) {
      if (!dto.startTime || !dto.endTime) {
        throw new BadRequestException(
          'startTime and endTime are required when isOpen is true.',
        );
      }
      const startTime = parseTimeOfDay(dto.startTime);
      const endTime = parseTimeOfDay(dto.endTime);
      if (endTime.getTime() <= startTime.getTime()) {
        throw new BadRequestException('endTime must be after startTime.');
      }
      return { startTime, endTime };
    }

    if (dto.startTime || dto.endTime) {
      throw new BadRequestException(
        'startTime/endTime must be omitted when isOpen is false.',
      );
    }
    return { startTime: null, endTime: null };
  }

  private serialize(row: {
    id: string;
    branchId: string;
    date: Date;
    isOpen: boolean;
    startTime: Date | null;
    endTime: Date | null;
    reason: string | null;
  }) {
    return {
      id: row.id,
      branchId: row.branchId,
      date: formatCalendarDate(row.date),
      isOpen: row.isOpen,
      startTime: row.startTime ? formatTimeOfDay(row.startTime) : null,
      endTime: row.endTime ? formatTimeOfDay(row.endTime) : null,
      reason: row.reason,
    };
  }
}
