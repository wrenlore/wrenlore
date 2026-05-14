# WrenLore Public Release Checklist

This checklist tracks gates that must be clear before publishing a public WrenLore repository.

## Clean-Fork Gates

- [x] `docs/provenance/public-release-provenance.md` is current for the public candidate.
- [x] No `apps/*/src/ee`, `packages/*/ee`, or equivalent inherited active `ee` path remains.
- [x] No proprietary Docmost EE dependency is declared in workspace manifests or lockfile.
- [x] No upstream Docmost EE source, assets, tests, docs, or line-by-line reimplementations are included.
- [x] No post-foundation cherry-pick, merge, rebase, port, translation, adaptation, or line-by-line reimplementation from upstream Docmost has occurred in this public candidate.
- [x] No items with unknown provenance are present in the public candidate. Unknown provenance is a blocker by policy; document uncertainty in `docs/provenance/public-release-provenance.md` rather than proceeding.
- [x] Fork-point tag exists in the repository and matches the tag referenced in README.

## Current Blockers

- [x] Final public-release candidate scan has no private repo URL, client name, private host/IP, test credential, or internal deployment note matches.
- [x] Dependency licence audit review completed for packages with missing metadata in `pnpm licenses list`: `pause` is MIT via npm metadata; `khroma@2.1.0` includes an MIT licence file despite missing package metadata.
- [ ] Client placeholders for MFA, API-key UI, and full AI provider/model administration need WrenLore-native product completion. These are roadmap items; affected surfaces are hidden from end users in the current release and do not block initial public release.
- [ ] API-key auth, attachment/PDF search, DOCX import, and Confluence import need WrenLore-native rebuilds. These are roadmap items; affected surfaces are hidden from end users in the current release and do not block initial public release.
- [ ] `.github/PULL_REQUEST_TEMPLATE.md` added and DCO GitHub Action configured before external contributions are accepted. Does not block initial public release; must be in place before any external PR is merged.

## Runtime and Deployment Gates

- [x] Docker Compose service, image, volume, and default database identifiers use WrenLore names.
- [x] Compose config validates with `docker compose config`.
- [x] Deployment docs describe volume or database migration risk from runtime renames.
- [x] Health smoke test passed on the private foundation deployment before public-candidate sanitisation; public candidate build checks pass. A fresh public-candidate runtime smoke can be run before approval if required.

## Functionality Gates

- [x] Login verified on the private foundation deployment before public-candidate sanitisation.
- [x] SSO settings visibility verified during foundation browser QA.
- [x] Audit Log v1 verified during foundation browser QA.
- [x] Disable Public Sharing policy gate verified during foundation browser QA.
- [x] Ask AI route via `/api/wren-ai/*` verified during foundation browser QA and API smoke.
- [x] AI Answers toggle/path verified during foundation browser QA and API smoke.

## Documentation Gates

- [x] README and deployment runbook match the public candidate state and do not overclaim.
- [x] Contribution rules state the clean-cut provenance policy.
- [x] Public release notes include the Docmost-derived AGPL boundary and WrenLore-native policy.
- [x] Public candidate contains no private remotes, private repo URLs, client names, private test credentials, or internal deployment notes in focused scans.