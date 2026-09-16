import { PrismaClient, Prisma, BookingStatus } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * LOCAL visual QA only — never run in CI, never against Neon/demo.
 * Fills tenant-a with many branches + bookings so you can judge dashboard
 * scroll/pagination in the browser. Idempotent-ish: skips branch names
 * that already exist; bookings are extra rows each run (do not loop this
 * against production).
 *
 *   docker exec booking-api npm run seed:visual
 */
const EXTRA_BRANCHES = 30;
const EXTRA_BOOKINGS = 25;

async function main() {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_super_admin', 'true', true)`;

      const tenant = await tx.tenant.findUniqueOrThrow({ where: { slug: 'tenant-a' } });
      const admin = await tx.user.findFirstOrThrow({
        where: { tenantId: tenant.id, email: 'admin@tenant.dev' },
      });
      const realBranch = await tx.branch.findFirstOrThrow({
        where: { tenantId: tenant.id, name: 'Sucursal Centro' },
      });
      const service = await tx.service.findFirstOrThrow({
        where: { branchId: realBranch.id },
      });
      const staff = await tx.staff.findFirstOrThrow({
        where: { branchId: realBranch.id },
      });

      for (let i = 1; i <= EXTRA_BRANCHES; i++) {
        const name = `Sucursal QA ${String(i).padStart(2, '0')}`;
        const exists = await tx.branch.findFirst({
          where: { tenantId: tenant.id, name },
        });
        if (!exists) {
          await tx.branch.create({
            data: {
              tenantId: tenant.id,
              name,
              timezone: 'America/Bogota',
            },
          });
        }
      }

      const statuses: BookingStatus[] = [
        BookingStatus.PENDING,
        BookingStatus.CONFIRMED,
        BookingStatus.CANCELLED,
      ];
      const durationMs = service.durationMinutes * 60 * 1000;
      // Far enough apart to satisfy the exclusion constraint on staff time_range.
      const start0 = new Date('2026-10-05T13:00:00.000Z');

      for (let i = 0; i < EXTRA_BOOKINGS; i++) {
        const startTime = new Date(start0.getTime() + i * 2 * 60 * 60 * 1000);
        const endTime = new Date(startTime.getTime() + durationMs);
        await tx.booking.create({
          data: {
            tenantId: tenant.id,
            branchId: realBranch.id,
            staffId: staff.id,
            serviceId: service.id,
            clientId: admin.id,
            startTime,
            endTime,
            status: statuses[i % statuses.length],
          },
        });
      }

      const branchCount = await tx.branch.count({
        where: { tenantId: tenant.id, deletedAt: null },
      });
      const bookingCount = await tx.booking.count({
        where: { tenantId: tenant.id },
      });
      console.log(
        `Visual QA tenant-a: ${branchCount} sucursales, ${bookingCount} reservas. ` +
          `Cerrar sesión en el browser y entrar de nuevo como tenant-a.`,
      );
    },
    { timeout: 30_000 },
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
