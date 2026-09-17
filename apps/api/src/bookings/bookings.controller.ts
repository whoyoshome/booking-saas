import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { GetBookingsQueryDto } from './dto/get-bookings-query.dto';
import { TenantScoped } from '../common/decorators/tenant-scoped.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.type';

@Controller('bookings')
@TenantScoped()
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBookingDto) {
    return this.bookingsService.create(user, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetBookingsQueryDto,
  ) {
    return this.bookingsService.findAll(user, query);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookingsService.findOne(id, user);
  }

  @Patch(':id/confirm')
  @Roles(Role.TENANT_ADMIN, Role.STAFF)
  confirm(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookingsService.confirm(id);
  }

  @Patch(':id/cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookingsService.cancel(id, user);
  }
}
