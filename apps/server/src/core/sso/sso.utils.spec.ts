import {
  buildRequestPublicUrl,
  buildSamlMetadata,
  canonicalizeSamlAcsUrl,
  getSamlAcsPath,
  normalizeSamlAcsUrl,
  SAML_HTTP_POST_BINDING,
} from './sso.utils';

describe('SAML SP utilities', () => {
  it('preserves the configured ACS URL while canonicalizing route matching', () => {
    const configured = 'https://tenant.example.com/customer-saml/';

    expect(normalizeSamlAcsUrl(configured)).toBe(configured);
    expect(canonicalizeSamlAcsUrl(configured)).toBe(
      'https://tenant.example.com/customer-saml',
    );
    expect(getSamlAcsPath(configured)).toBe('/customer-saml');
  });

  it('rejects ACS URLs with query strings or fragments', () => {
    expect(() =>
      normalizeSamlAcsUrl('https://tenant.example.com/acs?provider=one'),
    ).toThrow('query string or fragment');
    expect(() =>
      normalizeSamlAcsUrl('https://tenant.example.com/acs#response'),
    ).toThrow('query string or fragment');
  });

  it('builds a public callback URL from a proxied request', () => {
    expect(
      buildRequestPublicUrl({
        protocol: 'https',
        headers: { 'x-forwarded-host': 'tenant.example.com' },
        originalUrl: '/customer-saml/',
      }),
    ).toBe('https://tenant.example.com/customer-saml');
  });

  it('generates metadata with configured SP values', () => {
    const metadata = buildSamlMetadata({
      entityId: 'https://tenant.example.com/enterprise/saml/metadata',
      acsUrl: 'https://tenant.example.com/customer-saml/',
      acsBinding: SAML_HTTP_POST_BINDING,
      sloUrl: 'https://tenant.example.com/customer-saml/logout',
      nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    });

    expect(metadata).toContain(
      'entityID="https://tenant.example.com/enterprise/saml/metadata"',
    );
    expect(metadata).toContain(
      'Location="https://tenant.example.com/customer-saml/"',
    );
    expect(metadata).toContain(`Binding="${SAML_HTTP_POST_BINDING}"`);
    expect(metadata).toContain(
      '<NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>',
    );
  });
});
