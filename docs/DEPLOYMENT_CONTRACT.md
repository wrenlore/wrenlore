# WrenLore deployment contract

Status: initial Docker-only contract for the public single-command installer.

## Supported installation model

- Linux host
- Docker Engine with the Docker Compose plugin
- amd64 for the initial release; arm64 is explicitly deferred
- WrenLore application image plus digest-pinned PostgreSQL/pgvector and Redis containers
- Named Docker volumes for database, file storage, and Redis persistence
- Loopback-only HTTP publication by default (127.0.0.1:3000)
- TLS termination by an operator-managed reverse proxy

A native Node.js/PostgreSQL/Redis installation is not supported. Docker is the runtime boundary.

## Installer behaviour

The installer:

1. Detects Docker Engine and the Compose plugin.
2. If they are missing, explains the prerequisite and asks before using Docker's official Linux convenience installer.
3. Never installs Docker silently. Unattended installation requires both --yes and --install-docker.
4. Creates an installation directory (default ~/.wrenlore).
5. Generates and preserves strong application/database secrets in a mode-600 .env.
6. Downloads the canonical Compose definition.
7. Validates it, pulls configured images, starts the stack, and waits for health.
8. Is safe to rerun: existing secrets and persistent volumes are preserved.

## Runtime services

- wrenlore: WrenLore application, container port 3000
- db: PostgreSQL 18 with pgvector
- redis: Redis 8 with AOF persistence and no-eviction policy

## Persistence

- wrenlore_storage: uploaded and generated file storage
- db_data: PostgreSQL data
- redis_data: Redis append-only data

Normal reruns and docker compose down preserve all three volumes. Removing volumes is destructive and is never done by the installer.

## Required configuration

Generated automatically:

- APP_SECRET
- POSTGRES_PASSWORD

Stable defaults:

- POSTGRES_DB=wrenlore
- POSTGRES_USER=wrenlore
- PORT=3000
- APP_URL=http://localhost:3000

Operators must set the real external APP_URL when using a domain or reverse proxy.

## Health and readiness

- PostgreSQL: pg_isready
- Redis: redis-cli ping
- WrenLore: GET /api/health
- Installer success is reported only after the WrenLore container is healthy.

## Reruns and updates

A rerun refreshes the canonical Compose file, preserves .env, pulls the selected WrenLore tag, and reconciles the stack.

Release deployments should use immutable semantic tags. latest is a convenience default during the initial distribution phase, not the recommended production pin.

## Backup boundary

A complete backup requires:

- PostgreSQL dump or consistent backup of db_data
- Copy or snapshot of wrenlore_storage
- Copy of the installation .env

Redis is persistent for runtime continuity but is not the system of record.

## Deferred

- arm64 images
- Native/non-Docker installation
- Automatic TLS or reverse-proxy management
- Kubernetes/Helm
- Cloud marketplace images
