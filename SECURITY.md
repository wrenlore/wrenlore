# Security Policy

WrenLore is self-hosted knowledge infrastructure. Security issues should be reported privately first so maintainers have a fair chance to protect users before details become public.

## Supported versions

Security fixes are prepared against the current master branch and the latest public release tag.

| Version        | Supported   |
| -------------- | ----------- |
| Latest release | Yes         |
| Older releases | Best effort |

## Reporting a vulnerability

Please do not open a public GitHub issue for suspected vulnerabilities.

Use GitHub private vulnerability reporting if it is available on the repository. If that is not available, contact the project maintainers privately and include enough detail to reproduce the issue.

Helpful reports include:

- affected WrenLore version, commit, or Docker image;
- deployment type and relevant configuration, with secrets removed;
- clear reproduction steps;
- expected impact;
- logs or screenshots where useful, with private data redacted.

## Scope

In scope:

- authentication and session handling;
- MFA and recovery-code handling;
- authorization, workspace, space, group, and page permissions;
- document visibility or data isolation failures;
- stored or reflected cross-site scripting;
- server-side request forgery;
- dependency or container vulnerabilities that affect supported deployments.

Out of scope unless they expose sensitive data or bypass security boundaries:

- denial-of-service issues requiring unrealistic traffic or privileged local access;
- missing security headers without a concrete exploit path;
- social engineering;
- vulnerabilities in unsupported third-party deployments or modified forks.

## Disclosure process

Maintainers will acknowledge credible reports when possible, investigate privately, and publish fixes or advisories once users have a reasonable path to update.

Please give the project time to assess and fix confirmed issues before publishing details.
