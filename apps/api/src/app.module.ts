import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { BranchesModule } from './branches/branches.module';
import { ServicesModule } from './services/services.module';
import { StaffModule } from './staff/staff.module';
import { StaffSchedulesModule } from './staff-schedules/staff-schedules.module';
import { AvailabilityModule } from './availability/availability.module';
import { BranchSchedulesModule } from './branch-schedules/branch-schedules.module';
import { BookingsModule } from './bookings/bookings.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // Global default: 100 requests / 60s per IP. Generous enough not to
    // interfere with normal e2e test runs (dozens of requests in a tight
    // loop within one suite), tight enough to blunt casual scraping/abuse.
    // Individual endpoints override this — see AuthController.login for
    // the stricter brute-force limit.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
    }),
    RedisModule,
    PrismaModule,
    AuthModule,
    BranchesModule,
    ServicesModule,
    StaffModule,
    StaffSchedulesModule,
    AvailabilityModule,
    BranchSchedulesModule,
    BookingsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
