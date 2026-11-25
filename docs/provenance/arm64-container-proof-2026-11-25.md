# Native ARM64 container proof — 2026-11-25

Scope: native ARM64 build and clean Docker installation on Leo's Apple Silicon MacBook Pro. The proof used an isolated installation directory, Compose project and loopback port.

## Observed proof

1. Installed and started Docker Desktop for Apple Silicon under the test user's applications directory.
2. Built the WrenLore `0.1.12` source natively as `linux/arm64` from the repository's production Dockerfile.
3. Ran the public installer against the native image with the canonical digest-pinned PostgreSQL/pgvector and Redis images.
4. Completed first-run workspace setup through the HTTP API.
5. Created a real page titled `Native ARM64 proof`.
6. Confirmed WrenLore, PostgreSQL and Redis were all running as `linux/arm64` and healthy.
7. Restarted the WrenLore container and confirmed the page persisted and `/api/health` reported PostgreSQL and Redis up.

## Result

- WrenLore image: `linux/arm64`, healthy.
- PostgreSQL/pgvector image: `linux/arm64`, healthy.
- Redis image: `linux/arm64`, healthy.
- Restart persistence: passed.
- Application health after restart: passed.

This proves the application and complete documented Compose stack on native ARM64. Public registry manifest coverage is verified separately by the release workflow after publication.
