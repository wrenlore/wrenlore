# Contributing to WrenLore

WrenLore is Docmost-derived software licensed under AGPL-3.0, with a strict proprietary-code boundary and a clean-cut fork policy. Contributions must preserve both.

## Proprietary-code boundary

Do not contribute code, tests, assets, documentation, prompts, or implementation details copied, ported, translated, adapted, or line-by-line reimplemented from proprietary Docmost Enterprise Edition material or any other proprietary third-party source.

This rule applies even when proprietary material is visible in a public repository. Public visibility is not permission to reuse code, structure, tests, documentation, assets, or implementation details.

If a WrenLore feature overlaps with a proprietary feature from another product, implement it from WrenLore requirements, public standards, public documentation, public interoperability behaviour, and original work.

## Clean-cut fork policy

WrenLore does not accept contributions that cherry-pick, merge, rebase, port, translate, adapt, or line-by-line reimplement code from the upstream Docmost repository after the documented fork point.

Upstream Docmost is reference-only after the fork point. Security fixes and bug fixes are implemented independently in WrenLore from public vulnerability disclosures and WrenLore code analysis — not by porting upstream commits.

Feature overlap is allowed when implementation is WrenLore-native and based on WrenLore requirements, public standards, public API behaviour, and original first-principles implementation work.

## AI-assisted contribution policy

If you use AI-assisted tools such as Codex, Claude, Copilot, or similar systems in your contribution, you attest that no proprietary Docmost Enterprise Edition source, tests, documentation, assets, or implementation details were present as context during that AI-assisted session.

Do not paste proprietary third-party material into prompts, context files, screenshots, retrieval systems, or agent workspaces used to produce WrenLore contributions.

## Source and licensing expectations

By contributing, you confirm that:

- you have the right to submit the contribution;
- the contribution does not contain secrets, customer data, or private deployment material;
- the contribution does not include proprietary third-party code or materials unless WrenLore Foundation has confirmed in writing, before the contribution is submitted, that the material is authorised for inclusion under WrenLore's licence and distribution model;
- the contribution is compatible with WrenLore's AGPL-3.0 licensing posture.

## Developer Certificate of Origin

WrenLore requires Developer Certificate of Origin (DCO) sign-off on every commit in pull requests.

Use `git commit -s` when creating commits. This adds a `Signed-off-by:` trailer to the commit message.

The sign-off email must match the commit author email and the email associated with your GitHub identity for the contribution.

To fix an existing commit, use:

```bash
git commit --amend -s
```

To fix a pull request with multiple commits, use:

```bash
git rebase --signoff origin/master
```

After signing off, push the updated branch to the pull request. Do not rewrite WrenLore public history.

## Before opening changes

- Keep implementation paths and package names WrenLore-owned unless there is a documented reason to keep an upstream AGPL-derived alias.
- Avoid new `ee` directories, imports, aliases, or package names.
- Unknown provenance blocks public release. Document uncertainty in `docs/provenance/public-release-provenance.md` instead of guessing.
- Update `docs/provenance/public-release-provenance.md` when a change affects provenance or public-release readiness.
- Update deployment docs when runtime service, container, image, network, volume, or database defaults change.

## Client and private data

Do not commit:

- credentials, API keys, tokens, certificates, or private keys;
- real client names or client-specific configuration unless explicitly intended for a private deployment repo;
- private SAML/OIDC metadata;
- local agent/session metadata such as `.codex`;
- generated logs or local database dumps.

## Public release controls

Before moving anything from a private WrenLore repo to a public repo, complete [`docs/PUBLIC_RELEASE_CHECKLIST.md`](docs/PUBLIC_RELEASE_CHECKLIST.md).
