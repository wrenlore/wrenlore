#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="${WRENLORE_INSTALL_DIR:-$HOME/.wrenlore}"
VERSION="${WRENLORE_VERSION:-latest}"
PORT="${WRENLORE_PORT:-3000}"
PROJECT_NAME="${WRENLORE_PROJECT_NAME:-wrenlore}"
APP_URL="${WRENLORE_APP_URL:-}"
ASSUME_YES=0
ALLOW_DOCKER_INSTALL=0
BASE_URL="${WRENLORE_RELEASE_BASE_URL:-https://raw.githubusercontent.com/wrenlore/wrenlore/master}"

say() { printf "%s\n" "$*"; }
die() { printf "WrenLore installer: %s\n" "$*" >&2; exit 1; }

usage() {
  cat <<USAGE
Install WrenLore with Docker Compose.

Usage: install.sh [options]
  --yes                 Non-interactive mode; accept safe defaults
  --install-docker      Permit Docker Engine + Compose installation when missing
  --dir PATH            Installation directory (default: $HOME/.wrenlore)
  --port PORT           Local HTTP port (default: 3000)
  --app-url URL         Public WrenLore URL (default: http://localhost:PORT)
  --version VERSION     WrenLore image tag (default: latest)
  --help                Show this help

Examples:
  curl -fsSL https://raw.githubusercontent.com/wrenlore/wrenlore/master/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/wrenlore/wrenlore/master/install.sh | bash -s -- --yes --install-docker
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --yes) ASSUME_YES=1 ;;
    --install-docker) ALLOW_DOCKER_INSTALL=1 ;;
    --dir) [ "$#" -ge 2 ] || die "--dir requires a value"; INSTALL_DIR="$2"; shift ;;
    --port) [ "$#" -ge 2 ] || die "--port requires a value"; PORT="$2"; shift ;;
    --app-url) [ "$#" -ge 2 ] || die "--app-url requires a value"; APP_URL="$2"; shift ;;
    --version) [ "$#" -ge 2 ] || die "--version requires a value"; VERSION="$2"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

case "$PORT" in
  ""|*[!0-9]*) die "port must be a number" ;;
esac
[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "port must be between 1 and 65535"
[ -n "$APP_URL" ] || APP_URL="http://localhost:$PORT"

confirm() {
  local prompt="$1"
  [ -r /dev/tty ] || die "$prompt Re-run in a terminal, or use --yes --install-docker."
  printf "%s [y/N] " "$prompt" > /dev/tty
  read -r answer < /dev/tty
  case "$answer" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

install_docker() {
  [ "$(uname -s)" = "Linux" ] || die "automatic Docker installation is supported only on Linux"
  command -v curl >/dev/null 2>&1 || die "curl is required to install Docker"
  local run_prefix=()
  if [ "$(id -u)" -ne 0 ]; then
    command -v sudo >/dev/null 2>&1 || die "Docker installation requires root or sudo"
    run_prefix=(sudo)
  fi
  say "Installing Docker Engine and the Compose plugin using Docker's official convenience installer..."
  local tmp
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' RETURN
  curl -fsSL https://get.docker.com -o "$tmp"
  "${run_prefix[@]}" sh "$tmp"
}

docker_ready() {
  command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1
}

if ! docker_ready; then
  say "Docker Engine and the Docker Compose plugin are required but were not detected."
  if [ "$ALLOW_DOCKER_INSTALL" -eq 1 ]; then
    install_docker
  elif [ "$ASSUME_YES" -eq 1 ]; then
    die "Docker installation was not authorized; rerun with --yes --install-docker"
  elif confirm "Install Docker Engine and Docker Compose now?"; then
    install_docker
  else
    die "install Docker Engine + Compose, then rerun this installer"
  fi
fi

docker info >/dev/null 2>&1 || die "Docker is installed but this user cannot reach the daemon. Start Docker or grant this user access, then retry."

umask 077
mkdir -p "$INSTALL_DIR"
COMPOSE_FILE="$INSTALL_DIR/compose.yaml"
ENV_FILE="$INSTALL_DIR/.env"

command -v curl >/dev/null 2>&1 || die "curl is required to download the WrenLore deployment definition"
curl -fsSL "$BASE_URL/deploy/compose.yaml" -o "$COMPOSE_FILE.tmp"
mv "$COMPOSE_FILE.tmp" "$COMPOSE_FILE"

random_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else od -An -N32 -tx1 /dev/urandom | tr -d " \n"
  fi
}

if [ ! -f "$ENV_FILE" ]; then
  APP_SECRET="$(random_secret)"
  POSTGRES_PASSWORD="$(random_secret)"
  cat > "$ENV_FILE" <<ENV
WRENLORE_VERSION=$VERSION
COMPOSE_PROJECT_NAME=$PROJECT_NAME
APP_URL=$APP_URL
PORT=$PORT
APP_SECRET=$APP_SECRET
POSTGRES_DB=wrenlore
POSTGRES_USER=wrenlore
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
ENV
  chmod 600 "$ENV_FILE"
else
  say "Preserving existing configuration and secrets in $ENV_FILE"
fi

compose() {
  docker compose --project-directory "$INSTALL_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

say "Validating deployment definition..."
compose config --quiet
say "Starting WrenLore..."
if [ "${WRENLORE_SKIP_PULL:-0}" != "1" ]; then
  compose pull
fi
compose up -d --remove-orphans

say "Waiting for WrenLore to become healthy..."
deadline=$((SECONDS + 300))
while [ "$SECONDS" -lt "$deadline" ]; do
  container_id="$(compose ps -q wrenlore)"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
  case "$health" in
    healthy)
      say ""
      say "WrenLore is ready: $APP_URL"
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
