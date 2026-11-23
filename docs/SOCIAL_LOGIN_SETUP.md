# GitHub and Google social login

WrenLore can offer "Continue with GitHub" and "Continue with Google" buttons
on the login page. Each provider is configured independently per workspace in
**Workspace settings > Security > Social login**. Both providers start
disabled and stay hidden from the login page until they are configured and
enabled.

Social login is separate from enterprise SAML SSO. Workspaces that enforce
SSO (`Enforce SSO`) never show or accept social login or new account links; enforcement requires an
enabled SAML provider (see [SAML_ENTRA_SETUP.md](./SAML_ENTRA_SETUP.md)).

## Callback URLs

Each provider redirects back to a fixed WrenLore callback URL. The exact URL
for your instance is shown on the provider card in Security settings; it has
this shape:

```text
GitHub:  https://wrenlore.example.com/api/auth/social/github/callback
Google:  https://wrenlore.example.com/api/auth/social/google/callback
```

Register the URL exactly as shown, including scheme and host. WrenLore uses
server-side authorization-code flows only; the browser never sees the client
secret.

## GitHub OAuth app

1. In GitHub, open **Settings > Developer settings > OAuth Apps > New OAuth
   App** (or the organization equivalent).
2. Set the **Authorization callback URL** to the GitHub callback URL above.
3. Copy the **Client ID** and generate a **Client secret**.
4. In WrenLore Security settings, paste both into the GitHub card and enable
   the provider.

WrenLore requests only the `read:user` and `user:email` identity scopes and
uses the verified primary email address from GitHub. Access tokens are
discarded immediately after the identity is resolved. The authorization request
uses PKCE S256 and the code exchange sends the corresponding verifier, as
specified in [GitHub's OAuth app documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

## Google OAuth client

1. In Google Cloud Console, open **APIs & Services > OAuth consent screen**
   and configure it (External is fine). Add the `openid`, `email`, and
   `profile` scopes.
2. Under **Credentials**, create an **OAuth client ID** of type **Web
   application**.
3. Add the Google callback URL above as an **Authorized redirect URI**.
4. Copy the **Client ID** and **Client secret** into the Google card in
   WrenLore and enable the provider.

WrenLore validates Google `id_token` responses (signature, issuer, audience,
expiry, nonce) via Google's published OIDC metadata and uses the stable
Google account subject (`sub`) plus the `email_verified` claim.

## Identity, sign-up, and linking

- Accounts are matched by the stable provider account id (GitHub user id,
  Google `sub`), never by email alone. An existing WrenLore account is never
  attached to a provider identity automatically.
- With **Allow new sign-ups** enabled, a new WrenLore account is created only
  when the provider reports a verified email address and the workspace's
  allowed email domains (if set) accept it. The provider's verification is
  trusted, so no WrenLore email verification step is required.
- Existing members connect a provider themselves in
  **Account settings > Connected accounts**. Connecting requires a recent
  sign-in (within 10 minutes). The callback requires the initiating browser and
  the same valid WrenLore login session. Signing out or switching accounts while
  authorizing cancels the link; start again after signing in.
- A disconnected provider can be connected again, including a different provider
  identity. An active identity cannot be reassigned to another user or silently
  replaced. A provider's verified email only verifies the matching local address;
  linking a different email does not certify ownership of the local email.
- Disabling a provider immediately blocks new sign-in attempts, including
  authorization flows that are already in flight.

## Secrets

Client secrets are encrypted at rest with the instance `APP_SECRET`
(AES-256-GCM). The API and UI only ever report whether a secret is
configured; the stored value is never returned, logged, or written to audit
logs. Leaving the secret field empty when saving keeps the current secret.

## Browser state and MFA

Each attempt has a separate, short-lived HttpOnly, SameSite=Lax cookie, scoped to
the application host. HTTPS deployments use Secure and the `__Host-` prefix.
Redis stores a hash of that browser binding alongside the single-use state;
knowing the state alone is insufficient to finish the flow. Parallel tabs have
independent cookies. Cookies expire after ten minutes and are cleared on callback.

Social login uses the same MFA/session-completion code as password login.
A required MFA challenge does not update the last-login timestamp or emit a
successful-login audit event until the challenge succeeds. The signed MFA
challenge carries provider attribution through to the final audit event.
The browser consumes the MFA token from the URL fragment before deciding
whether to redirect, then clears the fragment and supports refreshing the form.

## Regression checks

Run the server suite and browser regression from the repository root:

```sh
pnpm --filter server exec jest --runInBand
pnpm exec playwright install chromium
node scripts/social-ui.cjs
```

For the database integration suite, create **disposable** PostgreSQL with pgvector
and Redis services. The runner requires a database name ending in `_social_test`
and applies migrations before testing. Never point it at an existing instance.

```sh
pnpm --filter server build
WRENLORE_SOCIAL_TEST=disposable \
SOCIAL_INTEGRATION_DB=postgresql://USER:PASSWORD@127.0.0.1:5432/wrenlore_social_test \
SOCIAL_INTEGRATION_REDIS=redis://127.0.0.1:6379 \
node scripts/social-ci.cjs
```

The social-authentication CI workflow runs these checks. HTTP tests exercise the
Nest/Fastify controllers, cookies and JWT guard. Google validation tests use the
real OIDC library against local mock token/JWKS endpoints with signed test tokens;
they cover signature, issuer, audience, expiry and nonce rejection. Database tests
cover reconnects and concurrent identity claims. Chromium tests cover the MFA
handoff and enforced-SSO account-link controls.

These checks do not replace live provider verification. Before rollout, register
both provider applications against a callback URL accepted by the provider, set
the matching trusted application URL, and test login, linking and MFA with real
accounts. Use HTTPS for the shared test host; a private HTTP hostname is not a
supported callback choice for Google. See [Google redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation).

The review fixes require no additional migration beyond this feature's additive
provider/identity indexes. Existing disconnected rows are reused transactionally;
no user, content or workspace tables are reset.
