import { SsoService } from './sso.service';
import { SAML } from '@node-saml/passport-saml';
import {
  SAML_DEFAULT_NAME_ID_FORMAT,
  SAML_HTTP_POST_BINDING,
} from './sso.utils';

describe('SsoService SAML configuration', () => {
  const providerId = '019e6a1c-3969-704e-b0fb-57549f2cb3ef';
  const workspaceId = '019e6a1c-3969-704e-b0fb-57549f2cb3ee';

  function createService(provider: Record<string, unknown>) {
    const query = {
      selectAll: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      executeTakeFirst: jest.fn().mockResolvedValue(provider),
      execute: jest.fn().mockResolvedValue([]),
    };
    const db = {
      selectFrom: jest.fn().mockReturnValue(query),
      insertInto: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnThis(),
        returningAll: jest.fn().mockReturnThis(),
        executeTakeFirst: jest.fn().mockResolvedValue(provider),
      }),
    };
    const workspaceRepo = {
      findById: jest.fn().mockResolvedValue({
        id: workspaceId,
        hostname: 'tenant',
      }),
    };
    const domainService = {
      getUrl: jest.fn().mockReturnValue('https://tenant.example.com'),
    };

    const service = new SsoService(
      db as any,
      workspaceRepo as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      domainService as any,
      { log: jest.fn() } as any,
    );

    return { service, query, db };
  }

  function samlProvider(overrides: Record<string, unknown> = {}) {
    return {
      id: providerId,
      workspaceId,
      type: 'saml',
      isEnabled: true,
      samlUrl: 'https://login.microsoftonline.com/tenant-id/saml2',
      samlCertificate: 'test-certificate',
      spEntityId: null,
      spAcsUrl: null,
      spAcsBinding: null,
      spSloUrl: null,
      nameIdFormat: null,
      idpEntityId: null,
      idpSloUrl: null,
      requestedAuthnContextMode: 'legacy-default',
      requestedAuthnContextClassRefs: [],
      requestedAuthnContextComparison: 'exact',
      ...overrides,
    };
  }

  async function generateAuthnRequest(service: SsoService) {
    const options = await (service as any).buildSamlOptions({
      params: { providerId },
    });
    const saml = new SAML(options);
    return (saml as any).generateAuthorizeRequestAsync(false, false);
  }

  it('creates new Entra providers with RequestedAuthnContext omitted', async () => {
    const provider = samlProvider({ requestedAuthnContextMode: 'omit' });
    const { service, db } = createService(provider);

    await service.createProvider(workspaceId, 'creator-id', {
      name: 'Entra ID',
      type: 'saml',
    });

    const insertValues = db.insertInto.mock.results[0].value.values;
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ requestedAuthnContextMode: 'omit' }),
    );
  });

  it('omits RequestedAuthnContext from Entra AuthnRequests', async () => {
    const { service } = createService(
      samlProvider({ requestedAuthnContextMode: 'omit' }),
    );

    const request = await generateAuthnRequest(service);

    expect(request).not.toContain('RequestedAuthnContext');
    expect(request).not.toContain('AuthnContextClassRef');
    expect(request).not.toContain('Password');
    expect(request).not.toContain('PasswordProtectedTransport');
  });

  it('emits configured AuthnContext class refs and comparison', async () => {
    const classRefs = [
      'urn:oasis:names:tc:SAML:2.0:ac:classes:X509',
      'urn:oasis:names:tc:SAML:2.0:ac:classes:TimeSyncToken',
    ];
    const { service } = createService(
      samlProvider({
        requestedAuthnContextMode: 'explicit',
        requestedAuthnContextClassRefs: classRefs,
        requestedAuthnContextComparison: 'minimum',
      }),
    );

    const request = await generateAuthnRequest(service);

    expect(request).toContain('RequestedAuthnContext');
    expect(request).toContain('Comparison="minimum"');
    expect(request).toContain(classRefs[0]);
    expect(request).toContain(classRefs[1]);
  });

  it('preserves the legacy AuthnRequest default for generic providers', async () => {
    const { service } = createService(samlProvider());

    const request = await generateAuthnRequest(service);

    expect(request).toContain('RequestedAuthnContext');
    expect(request).toContain('Comparison="exact"');
    expect(request).toContain(
      'urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport',
    );
  });

  it('uses customer-provided SP and IdP values in SAML runtime options', async () => {
    const provider = samlProvider({
      spEntityId: 'https://tenant.example.com/enterprise/saml/metadata',
      spAcsUrl: 'https://tenant.example.com/customer-saml/',
      spAcsBinding: SAML_HTTP_POST_BINDING,
      spSloUrl: 'https://tenant.example.com/customer-saml/logout',
      nameIdFormat: SAML_DEFAULT_NAME_ID_FORMAT,
      idpEntityId: 'https://sts.windows.net/tenant-id/',
      idpSloUrl: 'https://login.microsoftonline.com/tenant-id/saml2/logout',
    });
    const { service } = createService(provider);

    const options = await (service as any).buildSamlOptions({
      params: { providerId },
    });

    expect(options).toMatchObject({
      issuer: provider.spEntityId,
      audience: provider.spEntityId,
      callbackUrl: provider.spAcsUrl,
      identifierFormat: provider.nameIdFormat,
      idpIssuer: provider.idpEntityId,
      logoutUrl: provider.idpSloUrl,
      logoutCallbackUrl: provider.spSloUrl,
    });
  });

  it('keeps generated SP defaults for migrated providers', async () => {
    const { service } = createService(samlProvider());

    const options = await (service as any).buildSamlOptions({
      params: { providerId },
    });

    expect(options.issuer).toBe(
      `https://tenant.example.com/api/sso/saml/${providerId}/login`,
    );
    expect(options.callbackUrl).toBe(
      `https://tenant.example.com/api/sso/saml/${providerId}/callback`,
    );
    expect(options.identifierFormat).toBe(SAML_DEFAULT_NAME_ID_FORMAT);
  });

  it('exposes configured values in SP metadata', async () => {
    const provider = samlProvider({
      spEntityId: 'https://tenant.example.com/enterprise/saml/metadata',
      spAcsUrl: 'https://tenant.example.com/customer-saml/',
      spAcsBinding: SAML_HTTP_POST_BINDING,
    });
    const { service } = createService(provider);

    const metadata = await service.getSamlMetadata(providerId);

    expect(metadata).toContain(`entityID="${provider.spEntityId}"`);
    expect(metadata).toContain(`Location="${provider.spAcsUrl}"`);
  });

  it('maps a custom public ACS path to the configured provider', async () => {
    const provider = samlProvider({
      spAcsUrl: 'https://tenant.example.com/customer-saml/',
    });
    const { service, query } = createService(provider);
    query.execute.mockResolvedValue([
      { id: providerId, spAcsUrl: provider.spAcsUrl },
    ]);

    await expect(
      service.resolveProviderIdForAcs({
        protocol: 'https',
        headers: { host: 'tenant.example.com' },
        originalUrl: '/customer-saml',
      }),
    ).resolves.toBe(providerId);
  });
});
