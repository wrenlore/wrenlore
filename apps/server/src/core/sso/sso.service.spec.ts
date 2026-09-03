import { SsoService } from './sso.service';
import { SsoController } from './sso.controller';
import { SAML } from '@node-saml/passport-saml';
import {
  SAML_DEFAULT_NAME_ID_FORMAT,
  SAML_HTTP_POST_BINDING,
} from './sso.utils';

describe('SsoService SAML configuration', () => {
  const providerId = '019e6a1c-3969-704e-b0fb-57549f2cb3ef';
  const workspaceId = '019e6a1c-3969-704e-b0fb-57549f2cb3ee';
  const samlRequestCacheTtlMs = 10 * 60 * 1000;

  class FakeRedis {
    private nowMs = 0;
    readonly entries = new Map<string, { value: string; expiresAt: number }>();

    async set(key: string, value: string, ...args: unknown[]) {
      const pxIndex = args.indexOf('PX');
      const ttlArg = pxIndex >= 0 ? args[pxIndex + 1] : undefined;
      const ttlMs: number =
        typeof ttlArg === 'number' ? ttlArg : samlRequestCacheTtlMs;
      const nx = args.includes('NX');

      if (nx && (await this.get(key)) !== null) {
        return null;
      }

      this.entries.set(key, {
        value,
        expiresAt: this.nowMs + ttlMs,
      });
      return 'OK';
    }

    async get(key: string) {
      const entry = this.entries.get(key);
      if (!entry) {
        return null;
      }

      if (entry.expiresAt <= this.nowMs) {
        this.entries.delete(key);
        return null;
      }

      return entry.value;
    }

    async del(key: string) {
      const exists = (await this.get(key)) !== null;
      this.entries.delete(key);
      return exists ? 1 : 0;
    }

    advanceBy(ms: number) {
      this.nowMs += ms;
    }
  }

  function createService(
    provider: Record<string, unknown>,
    redis = new FakeRedis(),
  ) {
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
    const redisService = {
      getOrThrow: jest.fn().mockReturnValue(redis),
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
      redisService as any,
      { log: jest.fn() } as any,
    );

    return { service, query, db, redis };
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

  function extractAuthnRequestId(request: string) {
    const match = request.match(/ ID="([^"]+)"/);
    expect(match).not.toBeNull();
    return match![1];
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

  it('keeps InResponseTo validation enabled and stores AuthnRequest IDs in Redis', async () => {
    const { service, redis } = createService(samlProvider());

    const options = await (service as any).buildSamlOptions({
      params: { providerId },
    });
    const request = await (
      new SAML(options) as any
    ).generateAuthorizeRequestAsync(false, false);
    const requestId = extractAuthnRequestId(request);

    expect(options.validateInResponseTo).toBe('ifPresent');
    expect(options.requestIdExpirationPeriodMs).toBe(samlRequestCacheTtlMs);
    await expect(options.cacheProvider.getAsync(requestId)).resolves.toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
    expect(
      redis.entries.has(`sso:saml:request:${providerId}:${requestId}`),
    ).toBe(true);
  });

  it('makes AuthnRequest IDs available across SAML option instances and removes them after use', async () => {
    const redis = new FakeRedis();
    const provider = samlProvider();
    const { service: loginService } = createService(provider, redis);
    const { service: callbackService } = createService(provider, redis);

    const request = await generateAuthnRequest(loginService);
    const requestId = extractAuthnRequestId(request);
    const callbackOptions = await (callbackService as any).buildSamlOptions({
      params: { providerId },
    });

    await expect(
      callbackOptions.cacheProvider.getAsync(requestId),
    ).resolves.toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await expect(
      callbackOptions.cacheProvider.removeAsync(requestId),
    ).resolves.toBe(requestId);
    await expect(
      callbackOptions.cacheProvider.getAsync(requestId),
    ).resolves.toBeNull();
  });

  it('expires cached AuthnRequest IDs after the bounded request window', async () => {
    const redis = new FakeRedis();
    const provider = samlProvider();
    const { service: loginService } = createService(provider, redis);
    const { service: callbackService } = createService(provider, redis);

    const request = await generateAuthnRequest(loginService);
    const requestId = extractAuthnRequestId(request);
    redis.advanceBy(samlRequestCacheTtlMs + 1);
    const callbackOptions = await (callbackService as any).buildSamlOptions({
      params: { providerId },
    });

    await expect(
      callbackOptions.cacheProvider.getAsync(requestId),
    ).resolves.toBeNull();
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

describe('SsoController SAML callbacks', () => {
  it('sets the auth cookie and redirects after a successful SAML callback', async () => {
    const ssoService = {
      issueAuthCookieAndToken: jest.fn().mockResolvedValue('jwt-token'),
      setAuthCookie: jest.fn(),
      buildPostLoginRedirect: jest
        .fn()
        .mockResolvedValue('https://tenant.example.com/home'),
    };
    const controller = new SsoController(ssoService as any, {} as any);
    const req = {
      user: { id: 'user-id' },
      body: { RelayState: '/space/docs' },
      query: {},
    };
    const res = {
      redirect: jest.fn().mockReturnValue('redirect-response'),
    };

    await expect(controller.samlCallback(req as any, res as any)).resolves.toBe(
      'redirect-response',
    );

    expect(ssoService.issueAuthCookieAndToken).toHaveBeenCalledWith(req.user);
    expect(ssoService.setAuthCookie).toHaveBeenCalledWith(res, 'jwt-token');
    expect(ssoService.buildPostLoginRedirect).toHaveBeenCalledWith(
      req.user,
      '/space/docs',
    );
    expect(res.redirect).toHaveBeenCalledWith(
      'https://tenant.example.com/home',
    );
  });
});
