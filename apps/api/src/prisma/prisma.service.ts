import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { TenantContextStorage } from './tenant-context.storage';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly tenantContext: TenantContextStorage) {
    // Runtime connection: DATABASE_URL points to booking_app (non-superuser,
    // subject to RLS) — see .env.example and docker/postgres/init.sql.
    // DATABASE_MIGRATE_URL (booking_admin, superuser/owner) is reserved for
    // `prisma migrate` and admin scripts only, and is never read here.
    super();
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Conexión a PostgreSQL establecida (Prisma)');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Returns the tenant-scoped transactional client set up by
   * TenantContextInterceptor for the current request (with
   * app.current_tenant_id / app.is_super_admin already active via
   * set_config), or falls back to the plain client when there's no active
   * request context (seed scripts, unauthenticated routes, app bootstrap).
   *
   * From Step 5 onward, any repository touching an RLS-protected table
   * MUST query through `this.prisma.client.xxx`, never `this.prisma.xxx`
   * directly — the latter bypasses the tenant session variable entirely,
   * and depending on how the RLS policy is written, would see either every
   * tenant's rows or none at all.
   */
  get client(): PrismaClient | Prisma.TransactionClient {
    return this.tenantContext.getClient() ?? this;
  }
}
