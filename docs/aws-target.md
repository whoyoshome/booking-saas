# AWS target architecture

**Status: designed, not deployed.** The hosted demo runs on managed free tiers (see [deploy-demo.md](deploy-demo.md)). Do not describe the product as running on AWS until this layout is actually provisioned.

## Why ECS Fargate

The system is one NestJS API and one Next.js frontend. Fargate runs containers without managing nodes. EKS would add cluster operations, and self-managed EC2 would add patching and auto-scaling groups, with no benefit at this size.

## Components

| Capability | AWS service | Already proven in the repo |
|------------|-------------|----------------------------|
| API container | ECS Fargate + ALB | `apps/api/Dockerfile.prod`, `GET /health` |
| Frontend | CloudFront + S3, Amplify, or ECS | `apps/web/Dockerfile.prod` (demo on Vercel) |
| PostgreSQL + RLS | RDS for PostgreSQL | `docker/postgres/init.sql`, Prisma migrations, `booking_admin` / `booking_app` roles |
| Redis | ElastiCache | `REDIS_URL` (demo on Upstash) |
| Secrets | Secrets Manager | JWT secrets and database URLs, never plain text in the task definition |
| Images | ECR | Both production images |
| CI/CD | GitHub Actions or CodePipeline | `.github/workflows/ci.yml` |

## Bootstrap order

1. Provision RDS and run `init.sql` (roles, `btree_gist`, default privileges).
2. Run `prisma migrate deploy` with `DATABASE_MIGRATE_URL` (`booking_admin`).
3. Seed only if the environment needs demo data.
4. Provision ElastiCache and set `REDIS_URL`.
5. Build and push both `Dockerfile.prod` images to ECR.
6. Store the JWT secrets, `DATABASE_URL` (`booking_app`) and `REDIS_URL` in Secrets Manager.
7. Create the ECS task definition, service and ALB, with the health check on `/health`.
8. Build the frontend with `NEXT_PUBLIC_API_URL` set to the ALB URL. The value is fixed at build time.

Infrastructure as code is out of scope for this repository (see `AGENTS.md`).
