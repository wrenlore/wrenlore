# Install WrenLore with an AI agent

This guide is for people who want a coding or operations agent to install WrenLore on a machine they control.

The agent uses the same public installer as the normal one-command path. It does not receive a separate privileged installer or hidden credentials.

## Supported target

The current public deployment contract supports:

- a Linux or macOS Docker host using amd64 or arm64;
- Docker Engine and the Docker Compose plugin already installed and running;
- a user account that can run `docker` without privilege escalation;
- outbound HTTPS access to GitHub Container Registry, Docker Hub and GitHub raw content.

The WrenLore installer does not install Docker, use `sudo`, change group membership, modify package sources or configure a reverse proxy.

On macOS, use Docker Desktop as described on the normal [installation page](https://wrenlore.com/install/). Windows users should follow that page directly; the agent procedure below is bounded to the proved Linux and macOS paths.

## Paste this prompt into your agent

```text
Install WrenLore on this machine using the official WrenLore installer.

Before changing anything:
1. Confirm this is a Linux or macOS host with Docker reporting amd64 or arm64.
2. Confirm Docker Engine is running, the Docker Compose plugin is available, and the current user can run both `docker info` and `docker compose version` without sudo.
3. Check whether `$HOME/.wrenlore` already exists. If it does, treat it as an existing WrenLore installation and use that same directory. Do not replace, print, source or regenerate its `.env` file.
4. Do not install or reconfigure Docker, use sudo, change user groups, alter package repositories, delete containers or volumes, or adopt resources from another deployment. If a prerequisite is missing or an ownership/collision check fails, stop and report the exact blocker.

If all prerequisites pass, run:

curl -fsSL https://get.wrenlore.com/install.sh | bash

Use the default installation directory and port. Do not silently choose alternatives if port 3000 or the default project resources conflict; stop and ask me.

After the installer reports success:
1. Verify `curl -fsS http://127.0.0.1:3000/api/health` succeeds.
2. From `$HOME/.wrenlore`, run `docker compose --env-file .env -f compose.yaml ps` and confirm the WrenLore, PostgreSQL and Redis services are running and healthy.
3. Confirm `$HOME/.wrenlore/.env` is mode 600 without displaying its contents.
4. Report the local URL, installation directory, image tag and service health. Never include secret values in your reply.
```

## What the agent should report

A successful result should contain only operational facts, for example:

```text
WrenLore is ready.

URL: http://localhost:3000
Installation directory: /home/alex/.wrenlore
Image tag: latest
Health endpoint: OK
Services: wrenlore healthy, db healthy, redis healthy
Secrets file: present, mode 600 (contents not read or displayed)
```

It should not paste the generated `.env`, Docker inspection output containing environment values, database credentials or the application secret.

## Machine-checkable completion criteria

The installation is complete only when all of these checks pass:

```bash
test -f "$HOME/.wrenlore/compose.yaml"
test -f "$HOME/.wrenlore/.env"
test "$(stat -c '%a' "$HOME/.wrenlore/.env")" = "600"

curl -fsS http://127.0.0.1:3000/api/health

cd "$HOME/.wrenlore"
docker compose --env-file .env -f compose.yaml ps

for service in wrenlore db redis; do
  container_id="$(docker compose --env-file .env -f compose.yaml ps -q "$service")"
  test -n "$container_id"
  test "$(docker inspect --format='{{.State.Health.Status}}' "$container_id")" = "healthy"
done
```

The health response must report the application as ready with database and Redis up. The final loop must exit successfully for the `wrenlore`, `db` and `redis` services.

## Existing installations and reruns

A plain rerun in the same installation directory refreshes the canonical Compose definition, pulls the configured image and preserves the saved secrets and persistent volumes.

The agent must not:

- point the installer at volumes from a source-build or unrelated deployment;
- change the Compose project name of an existing installation;
- regenerate a missing `.env` over existing data;
- use `docker compose down -v` or otherwise remove volumes;
- claim success before the health endpoint and service state are verified.

If the existing `.env` is missing or damaged, restore it from backup. Do not create replacement credentials over the existing database.

## Custom port, URL or version

If you explicitly want different values, add them to the installer command:

```bash
curl -fsSL https://get.wrenlore.com/install.sh | \
  bash -s -- --port 3001 --app-url https://wiki.example.com --version 0.1.12
```

The agent must use only values you supplied or approved. Explicit options update those settings on rerun while preserving secrets.

For TLS, reverse proxies, backups, restore and production operation, continue with the [deployment runbook](../README-deploy.md) and [deployment contract](DEPLOYMENT_CONTRACT.md).
