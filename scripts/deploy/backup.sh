#!/usr/bin/env bash
set -Eeuo pipefail
INSTALL_DIR="${WRENLORE_INSTALL_DIR:-$HOME/.wrenlore}"; OUTPUT=""
say(){ printf '%s\n' "$*"; }; die(){ printf 'WrenLore backup: %s\n' "$*" >&2; exit 1; }
usage(){ cat <<USAGE
Usage: backup.sh [--dir PATH] [--output FILE]
USAGE
}
while [ "$#" -gt 0 ]; do case "$1" in
  --dir) [ "$#" -ge 2 ] || die '--dir requires a value'; INSTALL_DIR="$2"; shift;;
  --output) [ "$#" -ge 2 ] || die '--output requires a value'; OUTPUT="$2"; shift;;
  --help|-h) usage; exit 0;; *) die "unknown option: $1";; esac; shift; done
command -v docker >/dev/null || die 'docker is required'
docker compose version >/dev/null 2>&1 || die 'the Docker Compose plugin is required'
INSTALL_DIR="$(cd "$INSTALL_DIR" 2>/dev/null && pwd -P)" || die "installation directory not found: $INSTALL_DIR"
ENV_FILE="$INSTALL_DIR/.env"; COMPOSE_FILE="$INSTALL_DIR/compose.yaml"
[ -f "$ENV_FILE" ] || die "missing $ENV_FILE"; [ -f "$COMPOSE_FILE" ] || die "missing $COMPOSE_FILE"
[ -n "$OUTPUT" ] || OUTPUT="$PWD/wrenlore-backup-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
case "$OUTPUT" in /*) ;; *) OUTPUT="$PWD/$OUTPUT";; esac
[ ! -e "$OUTPUT" ] || die "output already exists: $OUTPUT"; mkdir -p "$(dirname "$OUTPUT")"
compose(){ env -u APP_URL -u PORT -u APP_SECRET -u POSTGRES_PASSWORD -u POSTGRES_USER -u POSTGRES_DB -u COMPOSE_PROJECT_NAME -u WRENLORE_VERSION -u WRENLORE_INSTALL_ID docker compose --project-directory "$INSTALL_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
COMPOSE_ENVIRONMENT="$(compose config --environment)"
env_value(){ printf '%s\n' "$COMPOSE_ENVIRONMENT" | awk -v key="$1=" 'index($0,key)==1 {print substr($0,length(key)+1)}'; }
POSTGRES_USER="$(env_value POSTGRES_USER)"; POSTGRES_DB="$(env_value POSTGRES_DB)"; PROJECT_NAME="$(env_value COMPOSE_PROJECT_NAME)"; VERSION="$(env_value WRENLORE_VERSION)"
[ -n "$POSTGRES_USER" ] && [ -n "$POSTGRES_DB" ] && [ -n "$PROJECT_NAME" ] || die 'incomplete installation environment'
compose ps -q db | grep -q . || die 'database service is not running'; compose ps -q wrenlore | grep -q . || die 'WrenLore service is not running'
umask 077; WORK_DIR="$(mktemp -d)"; APP_WAS_STOPPED=0
cleanup(){ status=$?; if [ "$APP_WAS_STOPPED" -eq 1 ]; then compose start wrenlore >/dev/null 2>&1 || true; fi; rm -rf -- "$WORK_DIR"; exit "$status"; }
trap cleanup EXIT INT TERM
cp -- "$ENV_FILE" "$WORK_DIR/.env"; cp -- "$COMPOSE_FILE" "$WORK_DIR/compose.yaml"
printf 'format=1\ncreated_utc=%s\ncompose_project=%s\nwrenlore_version=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PROJECT_NAME" "$VERSION" > "$WORK_DIR/manifest"
say 'Pausing WrenLore for a consistent backup...'; compose stop wrenlore >/dev/null; APP_WAS_STOPPED=1
say 'Dumping PostgreSQL...'; compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$WORK_DIR/database.dump"; [ -s "$WORK_DIR/database.dump" ] || die 'PostgreSQL dump is empty'
say 'Archiving file storage...'; compose run --rm --no-deps -T --entrypoint sh wrenlore -c 'tar -C /app/data/storage -czf - .' > "$WORK_DIR/storage.tar.gz"; tar -tzf "$WORK_DIR/storage.tar.gz" >/dev/null
compose start wrenlore >/dev/null; APP_WAS_STOPPED=0
tar -C "$WORK_DIR" -czf "$OUTPUT" manifest .env compose.yaml database.dump storage.tar.gz; chmod 600 "$OUTPUT"; say "Backup created: $OUTPUT"
