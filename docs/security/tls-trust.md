# Docker TLS trust

WrenLore's Docker image installs the distro `ca-certificates` package before
installing pnpm. npm certificate validation remains enabled for global and
production dependency installation. Build stages and both server entrypoints
inherit `NODE_OPTIONS=--use-openssl-ca`: Node uses OpenSSL's system trust store
instead of its independent bundled roots. This applies to default Node `https`
and `fetch`, including clients built on them. Custom clients that explicitly
supply their own CA list require separate review.

Do not replace `NODE_OPTIONS` without retaining `--use-openssl-ca`. Combining
system roots with bundled roots is not equivalent: an unwanted bundled root
would remain trusted. These defaults apply to the Docker image; a source-only
installation must maintain its OS CA store and select the same Node trust mode.

## eMudhra incident policy

The October 2026 incident affected multiple certificate chains, including a
cross-sign path through AAA Certificate Services. The build-time
`scripts/tls/ca-policy.mjs` identifies the relevant roots by DER SHA-256,
disables matching distro CA entries, refreshes the bundle and hashed links,
and fails if any denied root remains in the active store. Already-corrected
distro stores need no removals. No certificate is fetched by this script, and
unrelated roots are preserved. Custom local roots that match the denylist cause
a build failure rather than being silently accepted.

Sources:
- https://blog.cloudflare.com/emudhra-certificate-compromise/
- https://emudhra.we-have-a-problem.com/

This incident-specific policy should be reviewed against vendor guidance before
retirement. Record the source image digest and installed CA package version;
a Node version bump alone is not proof. Removing a cross-sign root can reveal
missing modern roots in stale images: rebuild with current vendor CA packages,
never disable TLS validation to restore connectivity.

## Private enterprise CA

Mount the administrator-approved PEM read-only and set
`NODE_EXTRA_CA_CERTS=/run/certs/company-ca.pem`. Retain the image's `NODE_OPTIONS`.
Restart the process after changing this startup setting. This explicitly adds
trust; administrators must not add the blocked incident roots or a bundle that
contains them. The offline regression suite proves that adding a test CA does
not disable hostname verification. Never use `NODE_TLS_REJECT_UNAUTHORIZED=0`,
`strict-ssl=false`, or an insecure HTTPS agent.

## Verification

Build the actual common stage and run the deterministic tests without external
network access (OpenSSL comes with the CA package):

```sh
docker build --target base -t wrenlore-tls-base .
docker run --rm --network none -v "$PWD/scripts/tls:/tls:ro" \
  wrenlore-tls-base node --test /tls/tls-policy.test.mjs
```

Build a fresh final image. Run the same tests under its default non-root user,
and opt in to the live incident/control checks:

```sh
docker build --pull --no-cache -t wrenlore-tls-candidate .
docker run --rm --network none -v "$PWD/scripts/tls:/tls:ro" \
  wrenlore-tls-candidate node --test /tls/tls-policy.test.mjs
docker run --rm -v "$PWD/scripts/tls:/tls:ro" \
  wrenlore-tls-candidate node /tls/verify-live.mjs
```

The live command tests 12 incident endpoints and four ordinary HTTPS controls
with both `https` and `fetch`. Only certificate trust failures count as a
successful negative result; DNS failures, timeouts and unrelated TLS errors are
unknown/failing checks. Third-party availability is not part of offline CI.

Deployment requires rebuilding and recreating application containers from the
verified image; restarting an old image does not patch its trust. This code
change does not change a running deployment or a server's inbound certificate.
Retain the previous image digest and deployment configuration for rollback,
but recognize that rolling back to an unpatched image restores its old trust
and build-verification weakness. Validate private integrations before rollout.
