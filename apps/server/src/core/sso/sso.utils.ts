export const SAML_PROVIDER_TYPE = 'saml' as const;

export function buildSamlEntityId(baseUrl: string, providerId: string): string {
  return `${baseUrl}/api/sso/saml/${providerId}/login`;
}

export function buildSamlCallbackUrl(
  baseUrl: string,
  providerId: string,
): string {
  return `${baseUrl}/api/sso/saml/${providerId}/callback`;
}

export function normalizeSamlCertificate(certificate: string): string {
  const normalized = certificate
    .replace(/\r/g, '')
    .replace(/\\r/g, '')
    .replace(/\\n/g, '\n')
    .trim();

  const body = normalized
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');

  if (!body) {
    return '';
  }

  const lines = body.match(/.{1,64}/g) ?? [body];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`;
}

export function toSafeRelativePath(
  target: unknown,
  appUrl: string,
): string | null {
  if (typeof target !== 'string' || target.trim().length === 0) {
    return null;
  }

  try {
    const resolved = new URL(target, appUrl);
    if (resolved.origin !== new URL(appUrl).origin) {
      return null;
    }

    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return null;
  }
}
