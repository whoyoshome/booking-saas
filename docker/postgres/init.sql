-- Se ejecuta automáticamente al crear el volumen por primera vez
-- (Postgres solo corre /docker-entrypoint-initdb.d en un data dir vacío).
--
-- btree_gist es requerida para poder usar EXCLUDE USING gist con columnas
-- de igualdad simple (staff_id) combinadas con un rango (time_range).
-- Sin esta extensión, el operador "=" no está disponible dentro de un
-- índice GiST y el exclusion constraint de la Fase 6 no se puede crear.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Fase 3, Paso 5 (fix posterior) — rol de runtime para la aplicación.
--
-- POSTGRES_USER (booking_admin) es creado como SUPERUSER por la imagen
-- oficial de postgres. Un superuser de PostgreSQL ignora Row Level
-- Security de forma incondicional, sin importar FORCE ROW LEVEL SECURITY
-- — la comprobación de RLS se salta antes de siquiera evaluar la policy.
-- Esto significa que, mientras la API se conectara con booking_admin, RLS
-- jamás se aplicaba de verdad: solo lo parecía porque nunca se probó con
-- una conexión no-superusuario.
--
-- De acá en adelante: booking_admin se usa SOLO para migraciones y scripts
-- administrativos (dueño de las tablas). booking_app es el rol con el que
-- la API se conecta en runtime — no es superuser, no es dueño de ninguna
-- tabla, y por lo tanto SÍ queda sujeto a las políticas RLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'booking_app') THEN
    CREATE ROLE booking_app WITH LOGIN PASSWORD 'change_me_local_only_app';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO booking_app;

-- Cualquier tabla que booking_admin cree de acá en adelante (es decir,
-- cada tabla creada por una migración de Prisma) otorga automáticamente
-- estos privilegios a booking_app — sin necesidad de un GRANT manual por
-- cada migración nueva.
ALTER DEFAULT PRIVILEGES FOR ROLE booking_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO booking_app;
