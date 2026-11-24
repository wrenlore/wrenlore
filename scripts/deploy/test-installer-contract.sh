#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

bash -n "$root/install.sh"
docker compose version >/dev/null
help="$(bash "$root/install.sh" --help)"
grep -q -- "--install-docker" <<<"$help"
grep -q -- "--yes" <<<"$help"

# Real Compose parser, mocked daemon: no image pulls or live Docker mutations.
python3 "$root/scripts/deploy/test-installer.py" "$@"
