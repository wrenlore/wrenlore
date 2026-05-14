# WrenLore Deployment Runbook (Docker Compose + Nginx TLS)

This runbook is for deploying the current WrenLore stack from this Git repo (not upstream Docmost images/update flow).

## Prerequisites

- Linux host with Docker Engine + Docker Compose plugin
- Git
- Nginx (if using reverse proxy + TLS termination)
- DNS name for your host (recommended for SSO testing)

Clone and enter repo:

```bash
git clone <your-wrenlore-repo-url> /opt/wrenlore
cd /opt/wrenlore
```

## Compose Stack (Current)

`docker-compose.yml` currently defines:

- `wrenlore` (WrenLore app), built from local source via `Dockerfile`
- `db` (Postgres 18 + pgvector), built from `docker/postgres.Dockerfile`
- `redis` (Redis 8)

`docker-compose.smoke.yml` is included for repeatable local smoke checks. Production deployments should use explicit environment values instead of smoke defaults.

## Required Environment Variables

Create/update `.env` in repo root for real deployments. Docker Compose also renders without `.env` for inspection, but production deployments must provide explicit values:

```env
# Public URL users will access (must match proxy URL)
APP_URL=https://docs-test.example.com

# Required; at least 32 chars
APP_SECRET=replace_with_a_long_random_secret

# Optional but recommended explicit DB credentials
POSTGRES_DB=wrenlore
POSTGRES_USER=wrenlore
POSTGRES_PASSWORD=strong_db_password
```

Notes:

- Compose injects internal `DATABASE_URL` and `REDIS_URL` for container networking.
- Do not use `REPLACE_WITH_LONG_SECRET` in real deployments.

Optional AI provider env vars (resolved at runtime from provider records):

```env
# Examples only; set only what your configured providers reference
OLLAMA_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
```

## Build and Start

Build from local modified codebase:

```bash
docker compose build --pull db wrenlore
```

Start stack:

```bash
docker compose up -d
docker compose ps
docker compose logs --no-color --tail=200 wrenlore
```

Stop stack:

```bash
docker compose down
```

Warning:

- `docker compose down -v` is destructive (removes DB/storage volumes).
- The default local DB name/user and file-storage volume were renamed from inherited Docmost defaults to WrenLore names in the clean-fork provenance slice. Existing local deployments using default Compose values need explicit migration or env overrides before reusing old data.

## First Run and Migrations

- On startup, server connects to DB and runs migrations automatically (`migrateToLatest` path).
- You should see migration status in `wrenlore` logs.
- No manual migration command is required for normal first boot.

## pgvector Requirement

- The DB image is built from `pgvector/pgvector:pg18` (`docker/postgres.Dockerfile`).
- AI Answers activation requires pgvector support in the app DB.
- If needed, verify inside DB:

```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
```

## Nginx Reverse Proxy + TLS Termination

Recommended: expose only `80/443`, keep app on internal `:3000`.

Example Nginx server block:

```nginx
server {
  listen 443 ssl http2;
  server_name docs-test.example.com;

  ssl_certificate /etc/letsencrypt/live/docs-test.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/docs-test.example.com/privkey.pem;

  client_max_body_size 200m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

Apply:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Local Ollama Notes (for AI Testing)

If Ollama runs on the Docker host:

- Host URL from app container should be `http://host.docker.internal:11434`
- `docker-compose.yml` already includes:
  - `extra_hosts: ["host.docker.internal:host-gateway"]`

If Ollama listens only on `127.0.0.1` on host, `host.docker.internal` is still the correct container-side target.

## AI Provider/Model Routing Caveat (Current Slice)

Temporary developer setup warning:

- AI provider/model/task-route configuration is currently DB/API-backed.
- It is not yet fully exposed as polished WrenLore-native admin UI.
- Treat current provider/model routing setup as interim developer configuration until the dedicated WrenLore AI provider admin UI slice lands.

## Entra ID SAML/SSO Pointers

Security/SSO settings are WrenLore-visible and should be configured there.

Key routes:

- Login: `/api/sso/saml/<providerId>/login`
- Callback (ACS): `/api/sso/saml/<providerId>/callback`

For Entra, ensure:

- `APP_URL` matches your real external HTTPS URL exactly
- Entra app Reply URL (ACS) uses the callback route above
- Entra Identifier/Login wiring matches the provider config shown in WrenLore UI
- Signing certificate is copied correctly into provider config

## AGPL Source Availability

WrenLore is AGPL-derived software. For any client or network deployment, keep a clear source-availability path for the exact version being served.

Recommended deployment practice:

1. Deploy from a tagged Git commit or immutable release archive.
2. Record the commit SHA/tag in the deployment notes.
3. Make the corresponding source available to users of that deployment under the applicable AGPL terms.
4. If deployment-specific patches are applied, keep those patches in the corresponding source revision as well.

Planned deployment model:

- Client on-prem and cloud deployments should run from a Git mirror, tagged release, or another source repository the client can access. The deployed version should match a commit/tag available in that source location.
- Public/self-hosted users should deploy from the public WrenLore repository or a tagged public release once available.
- Any single-tenant hosted/SaaS deployment should likewise run from the public/source-available WrenLore codebase or a clearly identified corresponding source revision.
- Multi-tenant SaaS is out of scope for now. If that changes, revisit AGPL source-offer mechanics and deployment documentation before launch.

## Backup and Update Warning

Do not use upstream Docmost update instructions/images for this deployment.

- Deploy WrenLore from this Git repo and your build pipeline.
- Rebuild from local source for each update:

```bash
git pull
docker compose build --pull db wrenlore
docker compose up -d
```

Back up before updates:

- Postgres volume (`db_data`)
- File storage volume (`wrenlore_storage`)

## Post-Startup Smoke Checks

1. Health endpoint:
   - `curl -f https://<your-domain>/api/health`
2. Admin login:
   - sign in with admin user in browser
3. AI Answers toggle:
   - settings toggle saves without pgvector/runtime error
4. Ask AI:
   - editor Ask AI action produces output (with working provider route)
5. Public sharing behavior:
   - when global disable is ON, existing public links return denied/404
   - when re-enabled, previously shared links become accessible again
6. Audit log:
   - admin can open/view audit log entries
