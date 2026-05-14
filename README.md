# WrenLore

WrenLore is Docmost-derived, self-hosted software for operational knowledge management by humans and agents.

It keeps the familiar wiki/documentation surface, then adds the pieces an agentic knowledge system needs: SSO, auditability, AI-assisted editing, grounded answers, controlled public sharing, and a path toward machine-readable retrieval.

WrenLore is derived from the Docmost Community Edition codebase. The WrenLore public foundation is tagged `wrenlore-open-foundation-2026-05-01` in this repository. The codebases diverge from that point. WrenLore is not an upstream Docmost deployment target, not affiliated with, and not endorsed by Docmost.

## What WrenLore is

WrenLore is intended for teams that need a durable internal knowledge system without sending everything to a third-party SaaS wiki.

The product direction is simple:

- humans browse, write, edit, and review knowledge in a clean UI
- agents publish, retrieve, summarize, and maintain knowledge through governed interfaces
- admins control access, audit activity, and deploy the system in private/client environments

## Licensing and provenance

Docmost and related marks are trademarks of Docmost Inc. WrenLore is not affiliated with, endorsed by, or presented as an official Docmost distribution.

WrenLore is derived from the AGPL-3.0-licensed Docmost Community codebase and is licensed under AGPL-3.0.

This repository does not include Docmost Enterprise Edition source code, assets, tests, documentation, or implementation details. Public visibility of any upstream Enterprise Edition material is not permission to reuse it. Feature overlap can exist between products; this project does not reuse proprietary Docmost EE implementation.

WrenLore complies with AGPL-3.0 source-availability obligations for distribution and network deployment. The source for each released version is available at this repository via the corresponding tag or release archive.

WrenLore's SSO, audit, AI, sharing controls, and other product capabilities are WrenLore-native implementations based on WrenLore requirements, public standards, public documentation, public interoperability behaviour, and original implementation work — not proprietary EE source.

## Upstream security posture

WrenLore is responsible for tracking security vulnerabilities in its dependency stack and in inherited Docmost Community-derived code. After the documented fork point, fixes are implemented independently in WrenLore from public vulnerability disclosures and WrenLore code analysis. WrenLore does not cherry-pick, merge, or rebase from upstream Docmost. Upstream Docmost release automation must not be used.

## Quick start

For local/dev deployment, see the full runbook:

- [`README-deploy.md`](README-deploy.md)

Minimal shape:

```bash
cp .env.example .env
# edit APP_URL, APP_SECRET, DB credentials, and provider env vars as needed

docker compose build --pull db wrenlore
docker compose up -d
curl -f http://localhost:3000/api/health
```

Do not use upstream Docmost update flows or official Docmost release automation for this repository.

## Development notes

Useful commands from the repo root:

```bash
pnpm install
pnpm run build
pnpm run client:dev
pnpm run server:dev
```

Docker is the preferred verification path for deployment-like checks.

## AI/runtime notes

Current AI functionality depends on configured provider/model/task routing.

For local Ollama from inside Docker, the app should generally use:

```text
http://host.docker.internal:11434
```

Provider/model setup is currently configured through environment-backed WrenLore provider records. A real admin UI for provider configuration, model discovery/selection, task-class routing, and health checks is planned for a future product slice.

## Documentation

Important docs:

- [`README-deploy.md`](README-deploy.md) — deployment runbook
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — contribution policy and proprietary-code boundary
- [`docs/PUBLIC_RELEASE_CHECKLIST.md`](docs/PUBLIC_RELEASE_CHECKLIST.md) — public release gates
- [`docs/provenance/public-release-provenance.md`](docs/provenance/public-release-provenance.md) — public provenance summary

## Product principles

For authoritative licence and compliance policy, see the Licensing and provenance section above. These principles are the practical engineering shorthand for developers.

- Build WrenLore as WrenLore, not as a Docmost Enterprise clone.
- Treat Docmost Community/AGPL code as the reusable foundation.
- Treat Docmost Enterprise Edition code and directories as proprietary/licensed material. Do not copy, paste, port, translate, adapt, or line-by-line reimplement EE source, structure, assets, tests, or documentation.
- Enterprise-grade capabilities may be added to WrenLore, but they must be specified from WrenLore product requirements, public standards, public API behaviour, and original first-principles implementation work.
- If a feature overlaps with a Docmost Enterprise feature, implement it as a WrenLore-native module from first principles. Do not use proprietary EE implementation details as source material.
- Reuse public concepts, protocols, and interoperability patterns where appropriate: SAML, OIDC, OAuth, REST, Postgres, pgvector, and similar public standards remain fair implementation ground. Open-source libraries may be used under their respective licences.
- Prefer hidden/deferred surfaces over fake or broken UI.
- Keep deployment self-hosted and understandable.
- Treat auditability, access control, and provenance as product features, not afterthoughts.
- Treat agent-facing workflows as first-class product concerns.

## Licence

WrenLore is licensed under AGPL-3.0.

WrenLore is provided as-is. See [`LICENSE`](LICENSE) for warranty and liability terms.