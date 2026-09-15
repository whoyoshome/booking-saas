import { PrismaClient, Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = 'ChangeMe123!';

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

/**
 * Classic bootstrapping problem: we do not expose a public registration
 * endpoint (who can create the first super_admin when nobody is authenticated
 * yet?). The standard solution is an administrative seed/script outside the
 * normal HTTP flow, not an open endpoint.
 */
async function seedSuperAdmin(tx: Prisma.TransactionClient) {
  const email = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@bookingsaas.dev';
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD ?? DEFAULT_PASSWORD;

  // NOTE — global lookup: SUPER_ADMIN has tenantId: null, so the composite
  // unique (tenantId, email) can't be used as a findUnique shortcut here in
  // the same way the tenant admins below can. findFirst mirrors the same
  // temporary lookup used in AuthService.login (see Step 2 of this phase).
  const existing = await tx.user.findFirst({ where: { email } });
  if (existing) {
    console.log(`Super admin already exists (${email}), skipping.`);
    return;
  }

  await tx.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      role: Role.SUPER_ADMIN,
      tenantId: null,
    },
  });

  console.log(`Super admin created: ${email} / ${password}`);
}

/**
 * Creates one demo tenant plus its TENANT_ADMIN user. Idempotent: upsert on
 * Tenant.slug (unique), and upsert on User's composite unique
 * (tenantId, email) via the named constraint from schema.prisma.
 */
async function seedTenantWithAdmin(
  tx: Prisma.TransactionClient,
  params: { slug: string; name: string; adminEmail: string },
) {
  const tenant = await tx.tenant.upsert({
    where: { slug: params.slug },
    update: {},
    create: {
      slug: params.slug,
      name: params.name,
    },
  });

  const admin = await tx.user.upsert({
    where: {
      tenant_email_unique: {
        tenantId: tenant.id,
        email: params.adminEmail,
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      email: params.adminEmail,
      passwordHash: await hashPassword(DEFAULT_PASSWORD),
      role: Role.TENANT_ADMIN,
    },
  });

  console.log(
    `Tenant ready: ${tenant.name} (slug: ${tenant.slug}, id: ${tenant.id})`,
  );
  console.log(`  Admin: ${admin.email} / ${DEFAULT_PASSWORD}`);
}

async function main() {
  // Step 5: `users` has FORCE ROW LEVEL SECURITY enabled. This script
  // connects via DATABASE_URL, which points to booking_app (non-superuser,
  // subject to RLS — see .env.example and docker/postgres/init.sql), not
  // booking_admin. So this bypass is NOT redundant: without it, every
  // insert/upsert below would be rejected by the tenant_isolation policy's
  // WITH CHECK clause, since no app.current_tenant_id is set and the row
  // being created (e.g. the SUPER_ADMIN, with tenantId: null) can't satisfy
  // `tenant_id = current_tenant_id` on its own.
  //
  // Everything below runs inside ONE transaction, on purpose: set_config
  // with is_local=true only stays in effect for the current transaction on
  // the SAME underlying connection. If these calls were separate
  // prisma.xxx queries outside a transaction, each one could be routed to
  // a different pooled connection, and the session variable set on one
  // would simply not exist on another — a subtle, easy-to-miss bug.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.is_super_admin', 'true', true)`;

    await seedSuperAdmin(tx);

    // Two tenants with the same admin email pattern is intentional: it's
    // the scenario that actually exercises the composite unique constraint
    // (tenantId, email) and, in Step 7 of this phase, the isolation tests.
    await seedTenantWithAdmin(tx, {
      slug: 'tenant-a',
      name: 'Tenant A (Demo Clínica)',
      adminEmail: 'admin@tenant.dev',
    });

    await seedTenantWithAdmin(tx, {
      slug: 'tenant-b',
      name: 'Tenant B (Demo Salón)',
      adminEmail: 'admin@tenant.dev',
    });
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
