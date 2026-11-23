# Public Release Provenance

This file records the public-facing provenance boundary for the WrenLore release candidate.

## Source

- Public candidate source tag: `wrenlore-open-foundation-2026-05-01`
- Source commit: same commit as tag `wrenlore-open-foundation-2026-05-01`
- Public target repository: `git@github.com:wrenlore/wrenlore.git`
- Public WrenLore version baseline: `0.1.0`

WrenLore is derived from the AGPL-licensed Docmost Community codebase. WrenLore is not affiliated with, endorsed by, or presented as an official Docmost distribution.

WrenLore public versioning starts at `0.1.0` from this clean open foundation. The inherited Docmost application version line is not continued for WrenLore public releases.

## Clean-Cut Policy

WrenLore uses a clean-cut policy for future development:

- Upstream Docmost may be used as reference-only after the documented foundation point.
- Do not cherry-pick, merge, rebase, port, translate, adapt, or line-by-line reimplement upstream Docmost commits or proprietary implementation details.
- Do not copy, paste, port, translate, adapt, or line-by-line reimplement Docmost Enterprise Edition source, assets, tests, or documentation.
- If WrenLore needs a capability that overlaps with a proprietary Docmost Enterprise Edition feature, implement it as WrenLore-native work from WrenLore requirements, public standards, public APIs, and clean-room engineering.
- Unknown provenance is a release blocker until documented and resolved.

## Public Candidate Sanitisation

The public candidate removes private operational records from the foundation tree, including local runtime reports, private deployment notes, private branch histories, client-specific planning notes, and private test credentials.

The retained provenance is intentionally public-facing:

- WrenLore is Docmost-derived and distributed under AGPL-3.0.
- Docmost Enterprise Edition remains separately licensed by Docmost.
- This public candidate does not include proprietary Docmost EE source or active EE dependencies.
- WrenLore-owned replacements and placeholders are labelled honestly.

## Current Public-Release Status

The current public candidate has:

- removed `apps/client/src/ee`
- removed licence-only `packages/ee`
- removed stale `.gitmodules` entries pointing to inherited EE paths
- removed active `@/ee` imports
- removed server dynamic `require(.../ee/*)` hooks
- renamed current product/runtime metadata to WrenLore-owned public URLs
- retained legal/provenance references to Docmost where needed for attribution and release policy

Known product gaps remain documented in `README.md` and `docs/PUBLIC_RELEASE_CHECKLIST.md`.

## Explicit URL sources for Ask AI

The URL retrieval service, status events, bounds and tests are original WrenLore work based on the explicit-URL product requirement, existing WrenLore APIs, and standard Node.js/HTTP behavior. The editor insertion fix was derived from reproducing WrenLore's toolbar and collaboration lifecycle in Chromium and WebKit. No proprietary Docmost material or post-fork upstream implementation was used. The changes retain WrenLore's AGPL-3.0 provenance boundary.

## Ask AI streaming preview

The preview auto-follow behavior and paced browser regression fixture are original WrenLore work based on its existing AI menu and the requirement to follow streamed output while respecting manual scrolling. No proprietary Docmost material or post-fork upstream implementation was used. The change does not alter the AGPL-3.0 provenance boundary.

## User-owned MCP agent connections

The MCP transport, scoped user tokens, direct collaborative editing, retry protocol,
attribution UI and regression tests are original WrenLore work derived from its
product requirements, existing WrenLore permission and collaboration code, public
MCP/OpenCode specifications, and the installed open-source MCP SDK and Hocuspocus
interfaces. No proprietary Docmost material or post-fork upstream implementation
was consulted or incorporated. The implementation uses dependencies already in
the repository and retains the AGPL-3.0 provenance boundary.

## November 2026 dependency maintenance

The dependency and GitHub Actions updates are based on public package metadata,
upstream security advisories and release records, and WrenLore regression tests.
They do not incorporate Docmost source or change the clean-cut provenance policy.
The reviewed versions and the deferred coordinated NestJS migration are recorded
in [the maintenance note](../security/dependencies-2026-11-21.md).

## Page history and agent-connection fixes in v0.1.11

The durable snapshot scheduling, chronological pagination, history viewer fixes,
user guide, actor-attribution correction and UI consistency changes are original
WrenLore work based on its existing code, user reports and reproduced behaviour.
Clipboard handling extends the existing open-source clipboard implementation in
this repository. The history tests use synthetic content; private page snapshots
used for local diagnosis are not included in the repository or release.
No proprietary Docmost material or post-fork upstream implementation was used.
These changes retain the documented clean-cut and AGPL-3.0 provenance boundary.

## GitHub and Google social login

The social authentication review fixes and regression tests are original WrenLore
work derived from the feature requirements, existing WrenLore authentication and
storage code, reproduced failures, GitHub's public OAuth documentation and the
installed open-source OIDC library. The tests use synthetic identities, signed
test tokens and disposable databases. No proprietary Docmost material or
post-fork upstream implementation was used; the AGPL-3.0 boundary is unchanged.
