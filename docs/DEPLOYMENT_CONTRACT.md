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

1. Verifies Docker Engine and the Compose plugin are already running and accessible to the current user.
2. Stops with a clear prerequisite error if Docker is missing or inaccessible; it does not install Docker, change user groups or elevate privileges.
3. Creates an installation directory (default ~/.wrenlore).
4. Checks for resource collisions, then generates and preserves strong application/database secrets in a mode-600 .env.
5. Downloads the canonical Compose definition.
6. Validates it, pulls configured images, starts the stack, and waits for health.
7. Preserves existing secrets and persistent volumes on reruns; explicit configuration options update their corresponding settings.

Each installation directory gets a stable, distinct Compose project name and a
random ownership ID stored in `.env`. Containers, volumes and the network carry
that ID. Before generating credentials or reconciling resources, the installer
checks both Compose project labels and conventional volume/network names. It
refuses resources owned by another installation, including volumes left after
`docker compose down`. It never removes orphan services.

`WRENLORE_PROJECT_NAME` can select a custom project on first installation. It
cannot switch the project of an existing installation. Use the same directory
for updates; use another directory and an available port for a separate instance.

Automatic adoption of source-build deployments or earlier draft installer
configurations without an ownership ID is unsupported. Keep using their original
Compose files and secrets. Do not point this installer at their volumes or
generate replacement credentials. If an installer `.env` is lost, restore the
original configuration from backup rather than regenerating it over existing data.

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
- WRENLORE_INSTALL_ID (resource ownership marker, not an authentication secret)

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

A plain rerun refreshes the canonical Compose file, preserves `.env` byte for
byte, pulls the configured WrenLore tag, and reconciles the owned stack.

Explicit `--version`, `--port` and `--app-url` options update only those settings;
omitted options retain their existing values. The corresponding
`WRENLORE_VERSION`, `WRENLORE_PORT` and `WRENLORE_APP_URL` environment options
have the same effect. Secrets, the project name, ownership ID, comments and other
operator configuration are preserved. Port and public URL are independent: set
both when changing a directly accessed localhost URL; a reverse-proxied public
URL can remain unchanged when its local backend port changes.

The installer stages configuration privately and validates it before replacing
files. Failed validation, ownership checks or image pulls leave the saved files
unchanged. If startup fails after reconciliation begins, the new configuration is
retained for diagnosis; this is not automatic database or application rollback.
The readiness message shows the effective configured public URL and local port.

`WRENLORE_IMAGE` is an optional custom-image override for testing. An explicit
`--version` is rejected while that override is active, rather than silently
ignoring the requested tag. Normal installations use the official image.

Release deployments should use immutable semantic tags. latest is a convenience default during the initial distribution phase, not the recommended production pin.

## Regression verification

Run `bash scripts/deploy/test-installer-contract.sh` with Python 3 and Docker
Compose available. These tests invoke the real Compose parser and simulate daemon
state; they never install Docker, pull images or start containers. They cover
separate installations, explicit updates, secret/configuration preservation,
foreign and leftover volumes, missing configuration, failed startup and failed
downloads. The deployment-installer workflow runs them and ShellCheck on PRs.
These checks complement, and do not claim to replace, a real-container smoke test.

## Backup boundary

A complete backup requires a PostgreSQL dump, the `wrenlore_storage` contents, the installation `.env`, and the Compose definition. `scripts/deploy/backup.sh` creates that bundle while the application is paused; `scripts/deploy/restore.sh` restores it only into an empty directory and unused Compose project. Redis is persistent for runtime continuity but is not the system of record. See [the operations guide](OPERATIONS.md).

## Deferred

- arm64 images
- Native/non-Docker installation
- Automatic TLS or reverse-proxy management
- Kubernetes/Helm
- Cloud marketplace images
