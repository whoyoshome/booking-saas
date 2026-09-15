import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TenantContextStorage } from './tenant-context.storage';
import { TenantContextInterceptor } from './tenant-context.interceptor';

// @Global(): PrismaService will be injected in virtually every domain module
// (bookings, tenants, availability...). Re-importing PrismaModule in each one
// would be noise with no real benefit — unlike a domain module with its own
// state, this is pure shared infrastructure access.
//
// TenantContextStorage and TenantContextInterceptor live here too, not in
// AuthModule: they are infrastructure for talking to Postgres correctly
// under RLS, not authentication logic. AuthModule decides WHO the user is;
// this module decides HOW their queries reach the database once that's
// known.
@Global()
@Module({
  providers: [PrismaService, TenantContextStorage, TenantContextInterceptor],
  exports: [PrismaService, TenantContextStorage, TenantContextInterceptor],
})
export class PrismaModule {}
