export const SAML_PROVIDER_TYPE = 'saml' as const;
export const SAML_HTTP_POST_BINDING =
  'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST' as const;
export const SAML_DEFAULT_NAME_ID_FORMAT =
  'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress' as const;
export const SAML_REQUESTED_AUTHN_CONTEXT_MODES = [
  'omit',
  'explicit',
  'legacy-default',
] as const;
export type SamlRequestedAuthnContextMode =
  (typeof SAML_REQUESTED_AUTHN_CONTEXT_MODES)[number];
export const SAML_AUTHN_CONTEXT_COMPARISONS = [
  'exact',
  'minimum',
  'maximum',
  'better',
] as const;
export type SamlAuthnContextComparison =
  (typeof SAML_AUTHN_CONTEXT_COMPARISONS)[number];

type SamlAuthnContextConfig = {
  requestedAuthnContextMode?: string | null;
  requestedAuthnContextClassRefs?: unknown;
  requestedAuthnContextComparison?: string | null;
};

export function buildSamlAuthnContextOptions(config: SamlAuthnContextConfig) {
  if (config.requestedAuthnContextMode === 'omit') {
    return { disableRequestedAuthnContext: true } as const;
  }

  if (config.requestedAuthnContextMode === 'explicit') {
    const authnContext = Array.isArray(config.requestedAuthnContextClassRefs)
      ? config.requestedAuthnContextClassRefs.filter(
          (value): value is string =>
            typeof value === 'string' && value.trim().length > 0,
        )
      : [];

    // Do not accidentally fall through to node-saml's password default if an
    // invalid row is introduced outside the validated provider API.
    if (authnContext.length === 0) {
      return { disableRequestedAuthnContext: true } as const;
    }

    const racComparison = SAML_AUTHN_CONTEXT_COMPARISONS.includes(
      config.requestedAuthnContextComparison as SamlAuthnContextComparison,
    )
      ? (config.requestedAuthnContextComparison as SamlAuthnContextComparison)
      : 'exact';

    return {
      disableRequestedAuthnContext: false,
      authnContext,
      racComparison,
    } as const;
  }

  // Omitting these options intentionally preserves node-saml's historical
  // PasswordProtectedTransport/exact defaults for legacy generic providers.
  return {};
}
export const CUSTOM_SAML_ACS_INTERNAL_PATH = '/api/sso/saml/custom-acs';
export const SAML_ACS_ORIGINAL_URL = Symbol('samlAcsOriginalUrl');

type RewritableRequest = {
  method?: string;
  url?: string;
  [SAML_ACS_ORIGINAL_URL]?: string;
};

export function rewriteCustomSamlAcsUrl(req: RewritableRequest): string {
  const url = req.url ?? '/';
  const pathname = url.split(/[?#]/, 1)[0];
  const isApiRequest = pathname === '/api' || pathname.startsWith('/api/');

  if (req.method?.toUpperCase() === 'POST' && !isApiRequest) {
    req[SAML_ACS_ORIGINAL_URL] = url;
    return CUSTOM_SAML_ACS_INTERNAL_PATH;
  }

  return url;
}

export function buildSamlEntityId(baseUrl: string, providerId: string): string {
  return `${baseUrl}/api/sso/saml/${providerId}/login`;
}

export function buildSamlCallbackUrl(
  baseUrl: string,
  providerId: string,
): string {
  return `${baseUrl}/api/sso/saml/${providerId}/callback`;
}

export function normalizeSamlAcsUrl(acsUrl: string): string {
  const parsed = new URL(acsUrl);
  if (parsed.search || parsed.hash) {
    throw new Error('SAML ACS URL cannot contain a query string or fragment.');
  }

  return parsed.toString();
}

export function canonicalizeSamlAcsUrl(acsUrl: string): string {
  const parsed = new URL(normalizeSamlAcsUrl(acsUrl));
  parsed.pathname = normalizeSamlAcsPath(parsed.pathname);
  return parsed.toString().replace(/\/$/, parsed.pathname === '/' ? '/' : '');
}

export function normalizeSamlAcsPath(path: string): string {
  const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
  if (withLeadingSlash === '/') {
    return withLeadingSlash;
  }

  return withLeadingSlash.replace(/\/+$/, '');
}

export function getSamlAcsPath(acsUrl: string): string {
  return normalizeSamlAcsPath(new URL(acsUrl).pathname);
}

export function buildRequestPublicUrl(req: any): string {
  const protocol = req.protocol ?? 'https';
  const host = req.headers?.['x-forwarded-host'] ?? req.headers?.host;
  const forwardedHost = Array.isArray(host) ? host[0] : host;
  const originalSamlAcsUrl =
    req.raw?.[SAML_ACS_ORIGINAL_URL] ?? req[SAML_ACS_ORIGINAL_URL];
  const pathname = normalizeSamlAcsPath(
    (originalSamlAcsUrl ?? req.originalUrl ?? req.url ?? '/').split(
      /[?#]/,
      1,
    )[0],
  );

  return normalizeSamlAcsUrl(`${protocol}://${forwardedHost}${pathname}`);
}

export function buildSamlMetadata(options: {
  entityId: string;
  acsUrl: string;
  acsBinding?: string | null;
  sloUrl?: string | null;
  nameIdFormat?: string | null;
}): string {
  const binding = options.acsBinding ?? SAML_HTTP_POST_BINDING;
  const nameIdFormat = options.nameIdFormat ?? SAML_DEFAULT_NAME_ID_FORMAT;
  const slo = options.sloUrl
    ? `<SingleLogoutService Binding="${escapeXml(binding)}" Location="${escapeXml(options.sloUrl)}"/>`
    : '';

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${escapeXml(options.entityId)}">`,
    '<SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">',
    slo,
    `<NameIDFormat>${escapeXml(nameIdFormat)}</NameIDFormat>`,
    `<AssertionConsumerService Binding="${escapeXml(binding)}" Location="${escapeXml(options.acsUrl)}" index="0" isDefault="true"/>`,
    '</SPSSODescriptor>',
    '</EntityDescriptor>',
  ].join('');
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => {
    const entities: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return entities[character];
  });
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
