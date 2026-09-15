-- Aplica el fix del rol booking_app a una base de datos que YA EXISTE
-- (init.sql solo corre en un volumen nuevo/vacío, así que este script
-- cubre el caso de un entorno local que ya venía corriendo antes del fix).
-- Es idempotente: correrlo más de una vez no falla ni duplica nada.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'booking_app') THEN
    CREATE ROLE booking_app WITH LOGIN PASSWORD 'change_me_local_only_app';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO booking_app;

-- Tablas que YA existen (tenants, users, _prisma_migrations) necesitan un
-- GRANT explícito una sola vez — ALTER DEFAULT PRIVILEGES de abajo solo
-- rige para tablas creadas DESPUÉS de que se ejecute esta sentencia.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO booking_app;

-- Para toda tabla que Prisma cree de acá en adelante (próximas
-- migraciones), este privilegio se otorga automáticamente.
ALTER DEFAULT PRIVILEGES FOR ROLE booking_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO booking_app;
