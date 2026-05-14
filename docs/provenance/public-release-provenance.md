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
