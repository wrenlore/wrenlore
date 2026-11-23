# GitHub and Google social login

WrenLore can offer "Continue with GitHub" and "Continue with Google" buttons
on the login page. Each provider is configured independently per workspace in
**Workspace settings > Security > Social login**. Both providers start
disabled and stay hidden from the login page until they are configured and
enabled.

Social login is separate from enterprise SAML SSO. Workspaces that enforce
SSO (`Enforce SSO`) never show or accept social login; enforcement requires an
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
discarded immediately after the identity is resolved.

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
  sign-in (within 10 minutes) to prevent session-hijack linking.
- Disabling a provider immediately blocks new sign-in attempts, including
  authorization flows that are already in flight.

## Secrets

Client secrets are encrypted at rest with the instance `APP_SECRET`
(AES-256-GCM). The API and UI only ever report whether a secret is
configured; the stored value is never returned, logged, or written to audit
logs. Leaving the secret field empty when saving keeps the current secret.
