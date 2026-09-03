# Changelog

## v0.1.5 - 2026-09-04

### Security
- Reduced 44 GitHub Dependabot alerts to 0 open alerts through PR #88.
- Removed vulnerable transitive `image-size` from the resolved dependency graph because no fixed package release was available for its reported advisories.
- Consolidated dependency and security updates from the remediation pass, including the regenerated Tiptap patch.

### Validation
- Verified frozen install with `corepack pnpm install --frozen-lockfile` under Node 22.22.2.
- Verified `pnpm audit --prod` reports no known vulnerabilities.
- Verified the full `pnpm audit` reports no known vulnerabilities.
- Verified the repository test command passes: 26 test suites, 152 tests.
- Verified the full build passes under Node 22.22.2.

### Release notes
- No deployment changes.
- No live-data changes.

## v0.1.3 - 2026-07-16

### Security
- Cleared the current GitHub Security & quality backlog for WrenLore after the July 2026 SAML/deployment work.
- Reduced GitHub Dependabot open alerts from 52 alert records to 0 open alerts on master.
- Kept the Docker/Node base-image major-version PR separate; PR #5 (node:22-slim -> node:26-slim) remains intentionally deferred for dedicated runtime validation.

### Dependency updates and pins
- Merged Dependabot updates for @nestjs/platform-fastify, DOMPurify, Nodemailer, Vite, ws, and actions/checkout.
- Added transitive security pins for @babel/core, @opentelemetry/core, esbuild, form-data, hono, js-yaml, linkify-it, markdown-it, protobufjs, react-router, shell-quote, tmp, undici, and ws.
- Closed duplicate Nodemailer PR #61 as superseded after PR #59 landed the manifest and lockfile update.

### Validation
- Verified GitHub Dependabot reports 0 open alerts after the cleanup.
- Verified frozen install under Node 22.22.2.
- Verified git diff whitespace checks.
- Verified server build and client production build under Node 22.
- Verified server Jest passes: 26 test suites, 144 tests.
- Noted that pnpm audit could not be used because npm returned HTTP 410 for the old audit endpoint; GitHub Dependabot was the source of truth.

### Known notes
- Existing client Vite chunk-size warnings remain.
- Existing ts-jest warnings about compiled editor-ext JavaScript remain.

## v0.1.2 - 2026-05-15

### Security
- Completed a full Dependabot and package-audit cleanup pass for the WrenLore fork.
- Brought the repository from a large inherited vulnerability backlog to a clean package-audit baseline.
- Cleared all open GitHub Dependabot alerts for the repository at the time of release.
- Reduced `pnpm audit` to 0 advisories on `master`.
- Addressed the critical inherited alerts first, then worked down through high, moderate, and low advisories.

### Critical advisories addressed
- Patched the `handlebars` advisory chain by pinning the vulnerable transitive dependency to `4.7.9`.
  - This covered multiple Handlebars advisories, including prototype/property-access validation bypasses and JavaScript-injection paths in template/precompiler handling.
  - In this tree the vulnerable path was pulled in through server-side test/build tooling rather than direct application code, but it still appeared in the repository security surface and was fixed.
- Patched the `protobufjs` advisory chain by pinning `protobufjs` to `7.5.6` and related protobuf helper packages where needed.
  - This covered code-generation, prototype-pollution, unsafe option path, and denial-of-service advisories reported through client telemetry/transitive OpenTelemetry dependency paths.

### High and moderate advisories addressed
- Updated or pinned vulnerable HTTP, parsing, templating, XML, YAML, URL, routing, and build-tool dependencies, including:
  - `@babel/plugin-transform-modules-systemjs`
  - `@fastify/static`
  - `@hono/node-server`
  - `@nestjs/core`
  - `@protobufjs/utf8`
  - `@xmldom/xmldom`
  - `axios`
  - `brace-expansion`
  - `dompurify`
  - `fast-uri`
  - `fast-xml-parser`
  - `fastify`
  - `follow-redirects`
  - `handlebars`
  - `happy-dom`
  - `hono`
  - `i18next-http-backend`
  - `ip-address`
  - `kysely`
  - `langsmith`
  - `lodash`
  - `lodash-es`
  - `mermaid`
  - `nodemailer`
  - `path-to-regexp`
  - `picomatch`
  - `postcss`
  - `protobufjs`
  - `serialize-javascript`
  - `uuid`
  - `vite`
  - `yaml`
- Merged safe Dependabot PRs where the update was straightforward and build-compatible.
- Used explicit `pnpm` overrides where Dependabot proposed unnecessary or risky major-version jumps, or where the vulnerable package was only present transitively.
- Avoided taking the `uuid` 14 major-version jump because pinning `uuid` to `11.1.1` cleared the advisory without widening the blast radius.
- Avoided blindly merging the Docker `node 22-slim` to `26-slim` PR because base-image major jumps need separate runtime validation.

### Dependency updates and pins
- Updated `nodemailer` from `7.0.12` to `8.0.5` to clear SMTP command-injection advisories.
- Updated `i18next-http-backend` from `2.7.3` to `3.0.5` to clear the path-traversal / URL-injection advisory.
- Pinned `uuid` to `11.1.1` to clear the BullMQ/transitive UUID advisory without taking a larger major upgrade.
- Pinned `lodash` and `lodash-es` to `4.18.1` to clear the remaining code-injection and prototype-pollution advisories reported through transitive dependency paths.
- Refreshed the lockfile after the security pins so the resolved dependency graph matches the clean audit state.

### Repository hygiene
- Added the security reporting baseline in `SECURITY.md`.
- Added and enforced DCO checks for repository contributions.
- Adjusted DCO handling so Dependabot sign-offs are parsed correctly rather than blocking safe automated security PRs.
- Closed superseded Dependabot PRs after equivalent or safer fixes had landed.

### Validation
- Verified `pnpm audit` reports 0 advisories on `master`.
- Verified GitHub Dependabot alerts report 0 open alerts at release time.
- Verified the server build passes.
- Verified the client TypeScript check passes.
- Verified the client Vite production build passes under Node `22.22.2`.
- Leo rebuilt WrenLore after the cleanup and confirmed the product still builds cleanly and works.

### Known notes
- The client build still reports existing Vite warnings about Excalidraw being both statically and dynamically imported.
- The client build still reports existing large chunk warnings.
- These are build-optimisation warnings, not release blockers for this security patch.
- This release describes the security posture of the WrenLore fork at release time. It is not intended as a public comparison with, or criticism of, any upstream project.


## v0.1.1 - 2026-05-15

### Added
- Native MFA v1 for local username/password users.
- Instance-wide setting to require MFA for local password users.
- TOTP setup, MFA login challenge, and recovery-code login.
- Recovery-code copy support during setup.

### Improved
- Page Access now shows readable user labels instead of raw IDs.
- Page creator is shown clearly as Creator with edit access.
- Users with edit access can manage page permissions.
- Restricted page visibility now works correctly with explicit view/edit permissions.
- Workspace Settings now displays the current WrenLore version.

### Fixed
- Stale MFA enrollments no longer cause login dead-ends or raw 500 errors.
- Users without page access cannot see restricted pages.
- Non-General spaces remain membership/group gated, while General remains broadly available via Everyone.
