-- CreateTable
CREATE TABLE "branch_schedules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_schedule_exceptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "is_open" BOOLEAN NOT NULL,
    "start_time" TIME,
    "end_time" TIME,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_schedule_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branch_schedules_tenant_id_idx" ON "branch_schedules"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_schedules_branch_id_day_of_week_idx" ON "branch_schedules"("branch_id", "day_of_week");

-- CreateIndex
CREATE INDEX "branch_schedule_exceptions_tenant_id_idx" ON "branch_schedule_exceptions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_schedule_exceptions_branch_id_date_key" ON "branch_schedule_exceptions"("branch_id", "date");

-- AddForeignKey
ALTER TABLE "branch_schedules" ADD CONSTRAINT "branch_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_schedules" ADD CONSTRAINT "branch_schedules_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_schedule_exceptions" ADD CONSTRAINT "branch_schedule_exceptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_schedule_exceptions" ADD CONSTRAINT "branch_schedule_exceptions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
