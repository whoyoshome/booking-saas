import { PrismaClient, Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'ChangeMe123!';

/**
 * SEPARATE from prisma/seed.ts on purpose. seed.ts is what `npm run seed`
 * runs in local docker-compose AND in CI's e2e job (docker-compose.yml,
 * .github/workflows/ci.yml) — every e2e spec across the whole test suite
 * creates its own branch/service/staff scoped to itself, but none of them
 * assert an exact starting COUNT of those resources for a tenant. Adding
 * demo data to seed.ts would probably be safe, but "probably" isn't good
 * enough for something CI depends on — a dedicated script removes the
 * risk entirely. Never wired into CI or docker-compose; run by hand,
 * once, against Neon, for the public demo only (Fase 11, Track 11-B).
 *
 * Same RLS bypass pattern as seed.ts: `users`, `branches`, `services`,
 * `staff`, `staff_services`, and `staff_schedules` all have
 * FORCE ROW LEVEL SECURITY — this script has no single tenant's session
 * context, so it needs app.is_super_admin = true, same as
 * AuthService.withSystemContext and seed.ts's own main().
 */

interface DemoTenantSpec {
  slug: string;
  branchName: string;
  branchTimezone: string;
  serviceName: string;
  durationMinutes: number;
  bufferMinutes: number;
  price: number;
  staffEmail: string;
}

// Two different business flavors and two different real IANA timezones —
// not just for narrative variety. Different timezones per tenant is also
// the most visible way a recruiter clicking through the demo can see the
// Fase 5 timezone-correct availability math actually working (a Bogotá
// slot and a Mexico City slot for the "same" local hour resolve to
// different UTC instants), not just trust that it's implemented.
const DEMO_TENANTS: DemoTenantSpec[] = [
  {
    slug: 'tenant-a',
    branchName: 'Sucursal Centro',
    branchTimezone: 'America/Bogota',
    serviceName: 'Corte de cabello',
    durationMinutes: 30,
    bufferMinutes: 10,
    price: 25000,
    staffEmail: 'ana@tenant-a.dev',
  },
  {
    slug: 'tenant-b',
    branchName: 'Sucursal Reforma',
    branchTimezone: 'America/Mexico_City',
    serviceName: 'Consulta general',
    durationMinutes: 45,
    bufferMinutes: 15,
    price: 45000,
    staffEmail: 'carlos@tenant-b.dev',
  },
];

// Monday-Friday, 09:00-17:00 local — deliberately every weekday, not a
// single fixed day. Test suites can afford one reference Monday because
// they control the clock; a live demo is opened on whatever real
// calendar date a recruiter happens to visit, so it needs to have
// SOMETHING bookable most days they might try, without seeding literally
// every day of the year.
const WEEKDAYS = [1, 2, 3, 4, 5];

async function seedDemoTenant(tx: Prisma.TransactionClient, spec: DemoTenantSpec) {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { slug: spec.slug } });

  // Branch has no natural unique key to upsert on (unlike Service, which
  // has @@unique([branchId, name])) — plain find-or-create instead,
  // same pattern used below for staffUser/staff.
  let branch = await tx.branch.findFirst({
    where: { tenantId: tenant.id, name: spec.branchName },
  });
  if (!branch) {
    branch = await tx.branch.create({
      data: {
        tenantId: tenant.id,
        name: spec.branchName,
        timezone: spec.branchTimezone,
      },
    });
  }

  const service = await tx.service.upsert({
    where: { branchId_name: { branchId: branch.id, name: spec.serviceName } },
    update: {},
    create: {
      tenantId: tenant.id,
      branchId: branch.id,
      name: spec.serviceName,
      durationMinutes: spec.durationMinutes,
      bufferMinutes: spec.bufferMinutes,
      price: spec.price,
    },
  });

  let staffUser = await tx.user.findFirst({
    where: { tenantId: tenant.id, email: spec.staffEmail },
  });
  if (!staffUser) {
    staffUser = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: spec.staffEmail,
        passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
        role: Role.STAFF,
      },
    });
  }

  let staff = await tx.staff.findFirst({ where: { userId: staffUser.id } });
  if (!staff) {
    staff = await tx.staff.create({
      data: { tenantId: tenant.id, branchId: branch.id, userId: staffUser.id },
    });
  }

  const existingAssignment = await tx.staffService.findUnique({
    where: { staffId_serviceId: { staffId: staff.id, serviceId: service.id } },
  });
  if (!existingAssignment) {
    await tx.staffService.create({
      data: { tenantId: tenant.id, staffId: staff.id, serviceId: service.id },
    });
  }

  for (const dayOfWeek of WEEKDAYS) {
    const existingSchedule = await tx.staffSchedule.findFirst({
      where: { staffId: staff.id, dayOfWeek },
    });
    if (!existingSchedule) {
      await tx.staffSchedule.create({
        data: {
          tenantId: tenant.id,
          staffId: staff.id,
          dayOfWeek,
          // Reference-date Time values, same convention as everywhere
          // else in the schema (staff-schedules module).
          startTime: new Date('1970-01-01T09:00:00.000Z'),
          endTime: new Date('1970-01-01T17:00:00.000Z'),
        },
      });
    }
  }

  const client = await tx.user.upsert({
    where: {
      tenant_email_unique: {
        tenantId: tenant.id,
        email: 'cliente@tenant.dev',
      },
    },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'cliente@tenant.dev',
      passwordHash: await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id }),
      role: Role.CLIENT,
    },
  });

  console.log(
    `Demo data ready for ${spec.slug}: branch "${branch.name}" (${branch.timezone}), ` +
      `service "${service.name}", staff ${staffUser.email} / ${DEMO_PASSWORD}, ` +
      `client ${client.email} / ${DEMO_PASSWORD}, Mon-Fri 09:00-17:00 local.`,
  );
}

async function main() {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_super_admin', 'true', true)`;
      for (const spec of DEMO_TENANTS) {
        await seedDemoTenant(tx, spec);
      }
    },
    { timeout: 20_000 }, // more writes than the base seed — a bit more headroom
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
