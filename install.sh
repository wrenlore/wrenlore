#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="${WRENLORE_INSTALL_DIR:-$HOME/.wrenlore}"
VERSION="${WRENLORE_VERSION:-latest}"
PORT="${WRENLORE_PORT:-3000}"
PROJECT_NAME="${WRENLORE_PROJECT_NAME:-}"
APP_URL="${WRENLORE_APP_URL:-}"
VERSION_EXPLICIT=0
PORT_EXPLICIT=0
APP_URL_EXPLICIT=0
[ -z "${WRENLORE_VERSION+x}" ] || VERSION_EXPLICIT=1
[ -z "${WRENLORE_PORT+x}" ] || PORT_EXPLICIT=1
[ -z "${WRENLORE_APP_URL+x}" ] || APP_URL_EXPLICIT=1
BASE_URL="${WRENLORE_RELEASE_BASE_URL:-https://raw.githubusercontent.com/wrenlore/wrenlore/master}"

say() { printf "%s\n" "$*"; }
die() { printf "WrenLore installer: %s\n" "$*" >&2; exit 1; }

usage() {
  cat <<USAGE
Install WrenLore with Docker Compose.

Usage: install.sh [options]
  --dir PATH            Installation directory (default: $HOME/.wrenlore)
  --port PORT           Local HTTP port (default: 3000)
  --app-url URL         Public WrenLore URL (default: http://localhost:PORT)
  --version VERSION     WrenLore image tag (default: latest)
  --help                Show this help

On reruns, explicit --version, --port and --app-url values update configuration;
omitted values and secrets are preserved. WRENLORE_PROJECT_NAME selects a project
on first install; an existing installation cannot switch projects.

Examples:
  curl -fsSL https://raw.githubusercontent.com/wrenlore/wrenlore/master/install.sh | bash
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir) [ "$#" -ge 2 ] || die "--dir requires a value"; INSTALL_DIR="$2"; shift ;;
    --port) [ "$#" -ge 2 ] || die "--port requires a value"; PORT="$2"; PORT_EXPLICIT=1; shift ;;
    --app-url) [ "$#" -ge 2 ] || die "--app-url requires a value"; APP_URL="$2"; APP_URL_EXPLICIT=1; shift ;;
    --version) [ "$#" -ge 2 ] || die "--version requires a value"; VERSION="$2"; VERSION_EXPLICIT=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

validate_port() {
  case "$1" in ""|*[!0-9]*) die "port must be a number" ;; esac
  [ "$1" -ge 1 ] && [ "$1" -le 65535 ] || die "port must be between 1 and 65535"
}
validate_version() {
  [[ "$1" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]] || die "invalid image tag"
}
validate_url() {
  case "$1" in http://?*|https://?*) ;; *) die "app URL must start with http:// or https://" ;; esac
  case "$1" in *$'\n'*|*$'\r'*|*"'"*|*\\*) die "app URL must be a single URL without quotes or backslashes" ;; esac
}
validate_port "$PORT"
validate_version "$VERSION"
[ -n "$APP_URL" ] || APP_URL="http://localhost:$PORT"
validate_url "$APP_URL"

docker_ready() {
  command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1
}

docker_ready || die "Docker Engine and the Docker Compose plugin are prerequisites. Install and start Docker, ensure this user can run docker commands, then rerun the WrenLore installer."

docker info >/dev/null 2>&1 || die "Docker is installed but this user cannot reach the daemon. Start Docker or grant this user access, then retry."

umask 077
mkdir -p -- "$INSTALL_DIR"
INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd -P)"
COMPOSE_FILE="$INSTALL_DIR/compose.yaml"
ENV_FILE="$INSTALL_DIR/.env"
STAGING_DIR="$(mktemp -d "$INSTALL_DIR/.installer.XXXXXX")"
trap 'rm -rf -- "$STAGING_DIR"' EXIT
COMPOSE_CANDIDATE="$STAGING_DIR/compose.yaml"
ENV_CANDIDATE="$STAGING_DIR/.env"

command -v curl >/dev/null 2>&1 || die "curl is required to download the WrenLore deployment definition"
curl -fsSL "$BASE_URL/deploy/compose.yaml" -o "$COMPOSE_CANDIDATE"

# Never source .env as shell code. Let Compose parse quoting/interpolation, while
# excluding ambient overrides of values managed and persisted by this installer.
compose() {
  env -u APP_URL -u PORT -u APP_SECRET -u POSTGRES_PASSWORD -u POSTGRES_USER \
    -u POSTGRES_DB -u COMPOSE_PROJECT_NAME -u WRENLORE_VERSION -u WRENLORE_INSTALL_ID \
    docker compose --project-directory "$INSTALL_DIR" --env-file "$ENV_CANDIDATE" \
    -f "$COMPOSE_CANDIDATE" "$@"
}
env_value() {
  printf '%s\n' "$COMPOSE_ENVIRONMENT" | awk -v key="$1=" 'index($0, key) == 1 { print substr($0, length(key) + 1) }'
}
random_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else od -An -N32 -tx1 /dev/urandom | tr -d " \n"
  fi
}
set_env_value() {
  # Values are single-line and cannot contain single quotes. Preserve unrelated
  # settings/comments and secret bytes; do not rewrite the file through a parser.
  WRENLORE_ENV_REPLACEMENT="$1='$2'" awk -v key="$1" '
    $0 ~ "^[[:space:]]*(export[[:space:]]+)?" key "[[:space:]]*=" {
      if (!seen++) print ENVIRON["WRENLORE_ENV_REPLACEMENT"]
      next
    }
    { print }
    END { if (!seen) print ENVIRON["WRENLORE_ENV_REPLACEMENT"] }
  ' "$ENV_CANDIDATE" > "$STAGING_DIR/env.updated"
  mv -- "$STAGING_DIR/env.updated" "$ENV_CANDIDATE"
}

INSTALL_ID=""
if [ -f "$ENV_FILE" ]; then
  cp -- "$ENV_FILE" "$ENV_CANDIDATE"
  chmod 600 "$ENV_CANDIDATE"
  COMPOSE_ENVIRONMENT="$(compose config --environment)"
  SAVED_PROJECT="$(env_value COMPOSE_PROJECT_NAME)"
  INSTALL_ID="$(env_value WRENLORE_INSTALL_ID)"
  [[ "$INSTALL_ID" =~ ^[a-f0-9]{64}$ ]] || die "Existing configuration has no installer ownership ID. Automatic adoption is not supported; keep using the existing deployment and its original secrets."
  [ -n "$SAVED_PROJECT" ] || die "Existing configuration is missing COMPOSE_PROJECT_NAME"
  [ -z "$PROJECT_NAME" ] || [ "$PROJECT_NAME" = "$SAVED_PROJECT" ] || die "Cannot change the project of an existing installation"
  PROJECT_NAME="$SAVED_PROJECT"
else
  if [ -z "$PROJECT_NAME" ]; then
    # Stable across reruns, relative paths and symlinks, distinct per directory.
    read -r directory_id _ < <(printf '%s' "$INSTALL_DIR" | cksum)
    PROJECT_NAME="wrenlore-$directory_id"
  fi
fi
[[ "$PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die "invalid Compose project name"

check_owner() {
  local kind="$1" resource="$2" owner format
  format='{{index .Labels "io.wrenlore.installation"}}'
  [ "$kind" != "container" ] || format='{{index .Config.Labels "io.wrenlore.installation"}}'
  owner="$(docker "$kind" inspect --format "$format" "$resource")" || die "Cannot inspect $kind $resource"
  [ -n "$INSTALL_ID" ] && [ "$owner" = "$INSTALL_ID" ] || die "Project $PROJECT_NAME already has $kind $resource owned by another installation. Refusing to change its containers, volumes or credentials. Use the original installation directory, or a different WRENLORE_PROJECT_NAME."
}
check_resources() {
  local resources resource kind
  resources="$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT_NAME")" || die "Cannot inspect existing containers"
  for resource in $resources; do check_owner container "$resource"; done
  # Check labels AND conventional names, including unlabeled pre-existing volumes
  # and networks. Volumes remain discoverable after compose down.
  for kind in volume network; do
    resources="$(docker "$kind" ls -q --filter "label=com.docker.compose.project=$PROJECT_NAME")" || die "Cannot inspect existing $kind resources"
    for resource in $resources; do check_owner "$kind" "$resource"; done
    resources="$(docker "$kind" ls -q --filter "name=^${PROJECT_NAME}_")" || die "Cannot inspect existing $kind names"
    for resource in $resources; do check_owner "$kind" "$resource"; done
  done
}

# Refuse collisions before generating secrets or committing any configuration.
check_resources
if [ ! -f "$ENV_FILE" ]; then
  INSTALL_ID="$(random_secret)"
  cat > "$ENV_CANDIDATE" <<ENV
WRENLORE_VERSION='$VERSION'
COMPOSE_PROJECT_NAME='$PROJECT_NAME'
WRENLORE_INSTALL_ID='$INSTALL_ID'
APP_URL='$APP_URL'
PORT='$PORT'
APP_SECRET=$(random_secret)
POSTGRES_DB=wrenlore
POSTGRES_USER=wrenlore
POSTGRES_PASSWORD=$(random_secret)
ENV
else
  say "Preserving existing secrets in $ENV_FILE"
  [ "$VERSION_EXPLICIT" -eq 0 ] || set_env_value WRENLORE_VERSION "$VERSION"
  [ "$PORT_EXPLICIT" -eq 0 ] || set_env_value PORT "$PORT"
  [ "$APP_URL_EXPLICIT" -eq 0 ] || set_env_value APP_URL "$APP_URL"
fi

say "Validating deployment definition..."
compose config --quiet
COMPOSE_ENVIRONMENT="$(compose config --environment)"
EFFECTIVE_URL="$(env_value APP_URL)"
EFFECTIVE_PORT="$(env_value PORT)"
validate_url "$EFFECTIVE_URL"
validate_port "$EFFECTIVE_PORT"
validate_version "$(env_value WRENLORE_VERSION)"
if [ "$VERSION_EXPLICIT" -eq 1 ] && [ -n "$(env_value WRENLORE_IMAGE)" ]; then
  die "WRENLORE_IMAGE overrides the image tag. Remove that override before using --version."
fi
if [ "${WRENLORE_SKIP_PULL:-0}" != "1" ]; then
  compose pull
fi
check_resources
# Commit only validated configuration, after image downloads have succeeded.
# Unchanged reruns leave the environment file byte-for-byte intact.
if ! cmp -s "$ENV_CANDIDATE" "$ENV_FILE"; then
  mv -- "$ENV_CANDIDATE" "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"
mv -- "$COMPOSE_CANDIDATE" "$COMPOSE_FILE"
ENV_CANDIDATE="$ENV_FILE"
COMPOSE_CANDIDATE="$COMPOSE_FILE"
say "Starting WrenLore (project $PROJECT_NAME)..."
compose up -d

say "Waiting for WrenLore to become healthy..."
deadline=$((SECONDS + 300))
while [ "$SECONDS" -lt "$deadline" ]; do
  container_id="$(compose ps -q wrenlore)"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
  case "$health" in
    healthy)
      say ""
      say "WrenLore is ready: $EFFECTIVE_URL"
      say "Local endpoint: http://127.0.0.1:$EFFECTIVE_PORT"
      say "Installation directory: $INSTALL_DIR"
      exit 0
      ;;
    unhealthy|exited|dead)
      compose logs --no-color --tail=100 wrenlore >&2 || true
      die "WrenLore failed to start (container state: $health)"
      ;;
  esac
  sleep 3
done

compose ps >&2 || true
compose logs --no-color --tail=100 wrenlore >&2 || true
die "timed out waiting for WrenLore health"
