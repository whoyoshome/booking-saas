# Track 11-C — AWS target (diseño, no desplegado)

Estado: **documentación / IaC pendiente de cuenta AWS**.  
No afirmar en el README que el producto “corre en AWS” hasta que exista un apply real (Track 11-D).

## Por qué Fargate (no EKS / EC2)

Misma regla anti-sobre-ingeniería del proyecto: un API Nest + un frontend.  
Fargate = contenedores sin gestionar nodos. EKS añade operación de cluster; EC2 self-managed añade parches/ASG que Fargate ya resuelve.

## Mapa de componentes

| Capacidad | Servicio AWS | Equivalente ya probado en el repo |
|-----------|--------------|-----------------------------------|
| Contenedor API | ECS Fargate + ALB | `apps/api/Dockerfile.prod` + `GET /health` |
| Frontend | CloudFront + S3, Amplify, o ECS | `apps/web` (hoy demo en Vercel) |
| Postgres + RLS | RDS PostgreSQL | `docker/postgres/init.sql` + 18 migraciones; roles `booking_admin` / `booking_app` |
| Redis | ElastiCache | `REDIS_URL` (hoy Upstash en demo) |
| Secretos | Secrets Manager | JWT + DB URLs — nunca en texto plano en la task definition |
| Imágenes | ECR | Push de las dos imágenes prod |
| CI | CodePipeline o seguir con GitHub Actions | `.github/workflows/ci.yml` |

## Orden de bootstrap (cuando haya cuenta)

1. RDS + ejecutar `init.sql` (roles, `btree_gist`, default privileges).
2. `prisma migrate deploy` con `DATABASE_MIGRATE_URL` (`booking_admin`).
3. Seed (opcional en prod; en demo sí).
4. ElastiCache → `REDIS_URL`.
5. ECR: build/push `Dockerfile.prod` (api + web).
6. Secrets Manager: JWT, `DATABASE_URL`, `REDIS_URL`, etc.
7. ECS task definition + service + ALB health check → `/health`.
8. Frontend con `NEXT_PUBLIC_API_URL` = URL del ALB (rebuild).

## Terraform / OpenTofu (opcional, sin apply)

Cuando se agregue `infra/`:

- Marcar en README: **not applied — requires AWS account**.
- Módulos mínimos: VPC (o default), RDS, ElastiCache, ECR, ECS/ALB, Secrets.
- State remoto (S3) solo cuando exista cuenta; hasta entonces `terraform plan` local es suficiente como señal de skill.

**Terraform CLI es gratis**; lo que cuesta es la infra en AWS al hacer `apply`.

## Relación con LocalStack

LocalStack **Hobby (gratis)** no incluye RDS / ElastiCache / ECR / ECS / ALB.  
No usar LocalStack Hobby como sustituto de este diseño. Student Pack / plan de pago / cuenta AWS real son los caminos para emular o desplegar esos servicios.
