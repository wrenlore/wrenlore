#!/usr/bin/env bash
set -Eeuo pipefail
INSTALL_DIR="${WRENLORE_INSTALL_DIR:-$HOME/.wrenlore}"; BACKUP=""
say(){ printf '%s\n' "$*"; }; die(){ printf 'WrenLore restore: %s\n' "$*" >&2; exit 1; }
usage(){ printf 'Usage: restore.sh --backup FILE [--dir PATH]\n'; }
while [ "$#" -gt 0 ]; do case "$1" in
  --backup) [ "$#" -ge 2 ] || die '--backup requires a value'; BACKUP="$2"; shift;;
  --dir) [ "$#" -ge 2 ] || die '--dir requires a value'; INSTALL_DIR="$2"; shift;;
  --help|-h) usage; exit 0;; *) die "unknown option: $1";; esac; shift; done
[ -n "$BACKUP" ] || die '--backup is required'; BACKUP="$(cd "$(dirname "$BACKUP")" && pwd -P)/$(basename "$BACKUP")"; [ -f "$BACKUP" ] || die "backup not found: $BACKUP"
command -v docker >/dev/null || die 'docker is required'; docker compose version >/dev/null 2>&1 || die 'the Docker Compose plugin is required'
if [ -e "$INSTALL_DIR" ] && [ -n "$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then die "restore directory is not empty: $INSTALL_DIR"; fi
mkdir -p -- "$INSTALL_DIR"; INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd -P)"; umask 077; WORK_DIR="$(mktemp -d)"; trap 'rm -rf -- "$WORK_DIR"' EXIT INT TERM
if tar -tzf "$BACKUP" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then die 'unsafe path in backup archive'; fi
tar -C "$WORK_DIR" -xzf "$BACKUP"
for f in manifest .env compose.yaml database.dump storage.tar.gz; do [ -f "$WORK_DIR/$f" ] || die "backup is missing $f"; done
grep -qx 'format=1' "$WORK_DIR/manifest" || die 'unsupported backup format'; tar -tzf "$WORK_DIR/storage.tar.gz" >/dev/null || die 'invalid storage archive'
ENV_FILE="$WORK_DIR/.env"; COMPOSE_FILE="$WORK_DIR/compose.yaml"
compose(){ env -u APP_URL -u PORT -u APP_SECRET -u POSTGRES_PASSWORD -u POSTGRES_USER -u POSTGRES_DB -u COMPOSE_PROJECT_NAME -u WRENLORE_VERSION -u WRENLORE_INSTALL_ID docker compose --project-directory "$INSTALL_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
compose config --quiet; COMPOSE_ENVIRONMENT="$(compose config --environment)"
env_value(){ printf '%s\n' "$COMPOSE_ENVIRONMENT" | awk -v key="$1=" 'index($0,key)==1 {print substr($0,length(key)+1)}'; }
POSTGRES_USER="$(env_value POSTGRES_USER)"; POSTGRES_DB="$(env_value POSTGRES_DB)"; PROJECT_NAME="$(env_value COMPOSE_PROJECT_NAME)"
[ -n "$POSTGRES_USER" ] && [ -n "$POSTGRES_DB" ] && [ -n "$PROJECT_NAME" ] || die 'backup has an incomplete installation environment'
if docker ps -aq --filter "label=com.docker.compose.project=$PROJECT_NAME" | grep -q . || docker volume ls -q --filter "name=^${PROJECT_NAME}_" | grep -q . || docker network ls -q --filter "name=^${PROJECT_NAME}_" | grep -q .; then die "Compose project already exists: $PROJECT_NAME"; fi
cp -- "$WORK_DIR/.env" "$INSTALL_DIR/.env"; cp -- "$WORK_DIR/compose.yaml" "$INSTALL_DIR/compose.yaml"; chmod 600 "$INSTALL_DIR/.env"; ENV_FILE="$INSTALL_DIR/.env"; COMPOSE_FILE="$INSTALL_DIR/compose.yaml"
say 'Starting PostgreSQL and Redis...'; compose up -d db redis
deadline=$((SECONDS+120)); health=''; while [ "$SECONDS" -lt "$deadline" ]; do id="$(compose ps -q db)"; health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || true)"; [ "$health" != healthy ] || break; case "$health" in unhealthy|exited|dead) die "database failed: $health";; esac; sleep 2; done; [ "$health" = healthy ] || die 'timed out waiting for PostgreSQL'
say 'Restoring PostgreSQL...'; compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges < "$WORK_DIR/database.dump"
say 'Restoring file storage...'; compose run --rm --no-deps -T --entrypoint sh wrenlore -c 'tar -C /app/data/storage -xzf -' < "$WORK_DIR/storage.tar.gz"
say 'Starting WrenLore...'; compose up -d
deadline=$((SECONDS+300)); while [ "$SECONDS" -lt "$deadline" ]; do id="$(compose ps -q wrenlore)"; health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || true)"; case "$health" in healthy) say "Restore complete: $INSTALL_DIR"; exit 0;; unhealthy|exited|dead) compose logs --no-color --tail=100 wrenlore >&2 || true; die "WrenLore failed: $health";; esac; sleep 3; done; die 'timed out waiting for WrenLore health'
