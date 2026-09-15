import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffScheduleExceptionDto } from './dto/create-staff-schedule-exception.dto';
import { UpdateStaffScheduleExceptionDto } from './dto/update-staff-schedule-exception.dto';
import { formatCalendarDate, formatTimeOfDay, parseCalendarDate, parseTimeOfDay } from '../common/util/time.util';

@Injectable()
export class StaffScheduleExceptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateStaffScheduleExceptionDto) {
    await this.assertStaffVisible(dto.staffId);

    const { startTime, endTime } = this.resolveAndValidateTimes(dto);

    try {
      const created = await this.prisma.client.staffScheduleException.create({
        data: {
          tenantId,
          staffId: dto.staffId,
          date: parseCalendarDate(dto.date),
          isAvailable: dto.isAvailable,
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
          'An exception already exists for this staff member on this date.',
        );
      }
      throw err;
    }
  }

  async findAll(staffId?: string) {
    const rows = await this.prisma.client.staffScheduleException.findMany({
      where: staffId ? { staffId } : {},
      orderBy: { date: 'asc' },
    });
    return rows.map((row) => this.serialize(row));
  }

  async findOne(id: string) {
    const row = await this.prisma.client.staffScheduleException.findFirst({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException('Schedule exception not found.');
    }
    return this.serialize(row);
  }

  async update(id: string, dto: UpdateStaffScheduleExceptionDto) {
    const existing = await this.requireRaw(id);

    const touchesAvailability = dto.isAvailable !== undefined;
    const touchesTimes = dto.startTime !== undefined || dto.endTime !== undefined;
    const isAvailable = dto.isAvailable ?? existing.isAvailable;

    let startTime = existing.startTime;
    let endTime = existing.endTime;

    // FIX — a PATCH that only touches an unrelated field (e.g. `reason`)
    // must NOT re-trigger "times are required" validation against an
    // already-valid, untouched isAvailable:true row. Only re-validate the
    // isAvailable/times combination when the caller actually touched
    // either of them, and resolve against the EXISTING values (not just
    // whatever the DTO happened to include) so a partial update like
    // "only change startTime, leave endTime as-is" works correctly too.
    if (touchesAvailability || touchesTimes) {
      const resolved = this.resolveAndValidateTimes({
        isAvailable,
        startTime: dto.startTime ?? (existing.startTime ? formatTimeOfDay(existing.startTime) : undefined),
        endTime: dto.endTime ?? (existing.endTime ? formatTimeOfDay(existing.endTime) : undefined),
      });
      startTime = resolved.startTime;
      endTime = resolved.endTime;
    }

    const updated = await this.prisma.client.staffScheduleException.update({
      where: { id },
      data: {
        date: dto.date ? parseCalendarDate(dto.date) : undefined,
        isAvailable,
        startTime,
        endTime,
        reason: dto.reason,
      },
    });

    return this.serialize(updated);
  }

  async remove(id: string): Promise<void> {
    await this.requireRaw(id);
    await this.prisma.client.staffScheduleException.delete({ where: { id } });
  }

  // --- internal helpers ---

  private async requireRaw(id: string) {
    const row = await this.prisma.client.staffScheduleException.findFirst({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException('Schedule exception not found.');
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

  /**
   * RULES confirmed before implementation:
   *   - isAvailable = true  -> startTime AND endTime are REQUIRED.
   *   - isAvailable = false -> startTime AND endTime must be ABSENT.
   *   - No overnight spans in v1 (endTime strictly after startTime).
   * A "not available" exception with a time range is a contradiction — we
   * reject it rather than silently ignoring the times or guessing intent.
   */
  private resolveAndValidateTimes(dto: {
    isAvailable: boolean;
    startTime?: string;
    endTime?: string;
  }): { startTime: Date | null; endTime: Date | null } {
    if (dto.isAvailable) {
      if (!dto.startTime || !dto.endTime) {
        throw new BadRequestException(
          'startTime and endTime are required when isAvailable is true.',
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
        'startTime/endTime must be omitted when isAvailable is false.',
      );
    }
    return { startTime: null, endTime: null };
  }

  private serialize(row: {
    id: string;
    staffId: string;
    date: Date;
    isAvailable: boolean;
    startTime: Date | null;
    endTime: Date | null;
    reason: string | null;
  }) {
    return {
      id: row.id,
      staffId: row.staffId,
      date: formatCalendarDate(row.date),
      isAvailable: row.isAvailable,
      startTime: row.startTime ? formatTimeOfDay(row.startTime) : null,
      endTime: row.endTime ? formatTimeOfDay(row.endTime) : null,
      reason: row.reason,
    };
  }
}
