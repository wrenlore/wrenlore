# Entra ID SAML setup

WrenLore can use generated service-provider (SP) values or values from an
existing Entra ID enterprise application registration. Configure the values in
**Workspace settings > Security > SSO**.

## Service Provider (WrenLore)

Set these fields to the values registered in Entra ID:

```text
SP Entity ID:    https://wrenlore.example.com/enterprise/saml/metadata
SP ACS URL:      https://wrenlore.example.com/saml-demo/
SP ACS binding:  urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST
NameID format:   urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress
SP SLO URL:      optional
```

- **SP Entity ID** must match the Entra **Identifier (Entity ID)**.
- **SP ACS / Reply URL** must match the Entra **Reply URL** exactly, including
  the public scheme, host, path, and trailing slash.
- The ACS URL may use any path routed to this WrenLore instance. It does not
  need to use WrenLore's generated `/api/sso/saml/.../callback` route.
- The ACS URL cannot contain a query string or fragment.
- The metadata URL shown in the form returns metadata containing the effective
  SP Entity ID, ACS URL, binding, NameID format, and optional SLO URL.

For an existing provider whose custom SP fields are blank, WrenLore continues
to use its generated Entity ID and ACS URL. Clear a custom field to return to
that behavior.

## Identity Provider (Entra ID)

Copy these values from the Entra enterprise application's SAML setup:

```text
IdP Entity ID:     https://sts.windows.net/<tenant-id>/
IdP SSO URL:       https://login.microsoftonline.com/<tenant-id>/saml2
IdP SLO URL:       optional
IdP certificate:   Entra SAML signing certificate, Base64
```

Enable the provider only after the IdP SSO URL and signing certificate are
present. WrenLore keeps the existing certificate normalization and signed
assertion/response validation behavior.

## Reverse proxy

The reverse proxy must forward the configured ACS path to WrenLore. A normal
catch-all application location is sufficient:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Do not redirect or rewrite the configured ACS path to the generated callback
route. WrenLore resolves the provider from the public ACS origin and path before
validating the SAML response.
