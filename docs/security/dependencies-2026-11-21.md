# Dependency maintenance — 2026-11-21

This maintenance pass addresses the 11 open GitHub Dependabot alerts observed on
2026-11-21. Versions are pinned through the existing pnpm override policy and the
lockfile, including transitive consumers.

| Package | Previous version | Fixed version | Dependabot alerts |
| --- | --- | --- | --- |
| `follow-redirects` | 1.16.1 | 1.16.2 | 390 |
| `glob` | 10.5.0 | 14.0.2 | 391 |
| `fast-xml-parser` | 5.7.0 | 5.12.0 | 393 |
| `@hono/node-server` | 2.1.3 | 2.1.6 | 394, 395 |
| `hono` | 4.13.11 | 4.13.16 | 396–400 |
| `minimatch` | 10.2.3 | 11.0.1 | 401 |

The advisory set covers redirect credential handling, abort-aware filesystem
traversal, pathological XML parsing, HTTP/WebSocket handling, Hono middleware
matching/validation, and glob-pattern amplification. The Glob and Minimatch
updates cross major versions; both retain CommonJS and ESM exports and support
the project's Node 24 runtime. Build, test discovery, database migration discovery
and application startup must be verified with the updated resolution.

The exact lockfile passed `pnpm install --frozen-lockfile` and `pnpm audit --json`
reported zero known vulnerabilities on 2026-11-21. This is a point-in-time result,
not a claim that application code or dependencies contain no vulnerabilities.
Existing peer warnings for React/React Router, Tiptap/Happy DOM, and
mapped-types/class-validator are not changed by this maintenance pass.

## GitHub Actions

All workflows use the same reviewed, immutable revisions:

- `actions/checkout` v7.0.1:
  `3d3c42e5aac5ba805825da76410c181273ba90b1`.
- `actions/setup-node` v7.1.0:
  `949feb2413d6458794dcd2491c4babbbce0c15c1`.
- `pnpm/action-setup` v4 commit proposed by Dependabot:
  `b906affcce14559ad1aafd4ab0e942779e9f58b1`.

These consolidate the updates proposed in #105, #106 and #110, including workflows
added after those pull requests were created. The DCO workflow also uses an exact
commit instead of a floating major tag. CI remains read-only and uses GitHub-hosted
Ubuntu runners.

## NestJS major upgrade remains separate

PR #103 updates only `@nestjs/platform-fastify` to 12.1.2. Its published peer
dependencies require `@nestjs/core` and `@nestjs/common` ^12.0.0; WrenLore currently
uses those packages on 11.x. Merging the adapter alone would create an unsupported
framework combination. Retain the 11.x adapter until a coordinated NestJS 12
migration is tested. This is not required to resolve the 11 alerts above; Fastify
already resolves to the patched 5.12.6 through the existing override.

No alerts are dismissed or hidden as part of this work. The reported MCP UI and
audit-log follow-ups (#148–#151) remain separate from dependency maintenance.
