# Public Release Candidate 2026-05-01

This note records preparation of the public release candidate for `github.com/wrenlore/wrenlore`.

## Candidate

- Candidate tree: separate local release-candidate working tree
- Candidate branch: `master`
- Source tag: `wrenlore-open-foundation-2026-05-01`
- Source commit: `9db5ee05936d543e235e2f8a5169ab048886116b`
- Public remote: `git@github.com:wrenlore/wrenlore.git`
- Public version baseline: `0.1.0`
- Public candidate commit: one clean initial commit on `master`
- Public foundation tag: `wrenlore-open-foundation-2026-05-01`, recreated locally on the clean public initial commit for the public candidate

## Public Sanitisation Actions

- Removed private operational provenance reports and local runtime records.
- Removed archived private planning/context documents and root implementation briefs.
- Removed the stale `.gitmodules` entry for the inherited Docmost EE path.
- Updated public repository URLs from private/internal locations to `github.com/wrenlore/wrenlore`.
- Reset WrenLore-owned package/app versions to `0.1.0`; WrenLore public versioning starts at the clean open foundation and does not continue inherited Docmost `0.70.3` versioning.
- Added `docs/provenance/public-release-provenance.md` as the public provenance summary.
- Updated `README.md`, `CONTRIBUTING.md`, `README-deploy.md`, and this checklist for public release-candidate posture.
- Removed the hard `env_file: .env` Compose requirement so `docker compose config` works in a fresh public clone.

## Verification Summary

Commands run in the public candidate:

```bash
git remote -v
focused private/internal-name scan across tracked text files, excluding `.git`, `node_modules`, and `dist`
private registry/private repository URL scan across manifests, lockfile, npm config, env example, Compose, and Docker metadata
test ! -e .gitmodules
test ! -d apps/client/src/ee
test ! -d packages/ee
git grep -n "@/ee" -- apps/client apps/server packages
git grep -n "require(.*ee\|from .*ee/" -- apps/server packages
git grep -n "@docmost/ee\|docmost.*ee" -- package.json pnpm-lock.yaml apps/*/package.json packages/*/package.json
find . -path ./.git -prune -o -path ./node_modules -prune -o -path '*/dist' -prune -o -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.gif' -o -iname '*.webp' -o -iname '*.mov' -o -iname '*.mp4' -o -iname '*.pdf' \) -print
PNG icon metadata scan for private/internal names, local paths, credentials, and upstream product identity
PATH=/home/less/.nvm/versions/node/v22.22.2/bin:$PATH pnpm install --frozen-lockfile
PATH=/home/less/.nvm/versions/node/v22.22.2/bin:$PATH pnpm licenses list
PATH=/home/less/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --dir packages/editor-ext exec tsc --build
PATH=/home/less/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --dir apps/server exec nest build
PATH=/home/less/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --dir apps/client exec tsc --noEmit
PATH=/home/less/.nvm/versions/node/v22.22.2/bin:$PATH pnpm --dir apps/client exec vite build
docker compose config
git diff --check
```

Results:

- Public remote is `git@github.com:wrenlore/wrenlore.git` for fetch and push.
- Focused private/internal scan returned no matches.
- Private registry/private repository URL scan returned no matches.
- `.gitmodules`, `apps/client/src/ee`, and `packages/ee` are absent.
- `@/ee` scan across active app/package code returned no matches.
- Proprietary Docmost EE package scan across manifests and lockfile returned no matches.
- Broad server/package `require(.*ee|from .*ee/)` scan matched only `@braintree/sanitize-url`, a third-party sanitiser package, not an EE loader.
- Binary/media scan found only four PNG app icons; `strings` scan found no private/client/upstream identity metadata.
- `pnpm install --frozen-lockfile` passed.
- `pnpm licenses list` ran. It reports missing licence metadata for transitive packages `khroma` and `pause`; review is complete: `pause` is MIT via npm metadata, and `khroma@2.1.0` includes an MIT licence file despite missing package metadata.
- Editor package build passed.
- Server build passed.
- Client TypeScript check passed.
- Client Vite production build passed with existing large-chunk and Excalidraw static/dynamic import warnings.
- `docker compose config` passed after removing the required `.env` file dependency.
- `git diff --check` passed.

## Push Gate

This candidate must not be pushed to `github.com/wrenlore/wrenlore` until the checklist passes and final approval is given.

Remaining public-push blocker:

- Public remote access still needs confirmation before pushing to `github.com/wrenlore/wrenlore`.
