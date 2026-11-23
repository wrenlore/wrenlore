import { SsoService } from './sso.service';
import { SsoController } from './sso.controller';
import { BadRequestException } from '@nestjs/common';
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
      { encrypt: jest.fn((v: string) => `enc:${v}`), decrypt: jest.fn() } as any,
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

  it('keeps post-login redirects inside the workspace origin', async () => {
    const { service } = createService(samlProvider());
    const user = { workspaceId } as any;

    await expect(
      service.buildPostLoginRedirect(user, '/space/docs?tab=1#section'),
    ).resolves.toBe('https://tenant.example.com/space/docs?tab=1#section');
    await expect(
      service.buildPostLoginRedirect(
        user,
        'https://tenant.example.com/settings',
      ),
    ).resolves.toBe('https://tenant.example.com/settings');
  });

  it('falls back for unsafe post-login redirect targets', async () => {
    const { service } = createService(samlProvider());
    const user = { workspaceId } as any;

    for (const unsafeTarget of [
      'https://evil.example.com/phish',
      '//evil.example.com/phish',
      'http://tenant.example.com/not-https',
      'http://[',
      '',
    ]) {
      await expect(
        service.buildPostLoginRedirect(user, unsafeTarget),
      ).resolves.toBe('https://tenant.example.com/home');
    }
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
    const sendResult = {};
    const res = {
      setCookie: jest.fn(),
      status: jest.fn().mockReturnThis(),
      header: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnValue(sendResult),
    };

    await expect(controller.samlCallback(req as any, res as any)).resolves.toBe(
      sendResult,
    );

    expect(ssoService.issueAuthCookieAndToken).toHaveBeenCalledWith(req.user);
    expect(ssoService.setAuthCookie).toHaveBeenCalledWith(res, 'jwt-token');
    expect(ssoService.buildPostLoginRedirect).toHaveBeenCalledWith(
      req.user,
      '/space/docs',
    );
    expect(res.status).toHaveBeenCalledWith(303);
    expect(res.header).toHaveBeenCalledWith(
      'Location',
      'https://tenant.example.com/home',
    );
    expect(res.send).toHaveBeenCalledTimes(1);
  });
});

describe('SsoService social provider management', () => {
  const workspaceId = '019e6a1c-3969-704e-b0fb-57549f2cb3ee';
  const providerId = '019e6a1c-3969-704e-b0fb-57549f2cb3ef';

  function createSocialHarness(options: { insertError?: unknown } = {}) {
    let insertedValues: Record<string, unknown> | null = null;
    let updatedValues: Record<string, unknown> | null = null;

    const providerRow = {
      id: providerId,
      workspaceId,
      type: 'github',
      name: 'GitHub',
      isEnabled: false,
      allowSignup: false,
      oidcClientId: 'client-id',
      oidcClientSecret: 'enc:secret',
      samlCertificate: null,
      spAcsUrlKey: null,
      deletedAt: null,
    };

    const selectChain: any = {
      selectAll: () => selectChain,
      select: () => selectChain,
      where: () => selectChain,
      orderBy: () => selectChain,
      executeTakeFirst: jest.fn().mockResolvedValue(providerRow),
      execute: jest.fn().mockResolvedValue([providerRow]),
    };

    const insertChain: any = {
      values: (v: any) => {
        insertedValues = v;
        return insertChain;
      },
      returningAll: () => insertChain,
      executeTakeFirstOrThrow: jest.fn().mockImplementation(async () => {
        if (options.insertError) throw options.insertError;
        return { ...providerRow, ...insertedValues };
      }),
    };

    const updateChain: any = {
      set: (v: any) => {
        updatedValues = v;
        return updateChain;
      },
      where: () => updateChain,
      returningAll: () => updateChain,
      executeTakeFirstOrThrow: jest.fn().mockImplementation(async () => ({
        ...providerRow,
        ...updatedValues,
      })),
    };

    const db = {
      selectFrom: jest.fn().mockReturnValue(selectChain),
      insertInto: jest.fn().mockReturnValue(insertChain),
      updateTable: jest.fn().mockReturnValue(updateChain),
    };

    const cryptoService = {
      encrypt: jest.fn((v: string) => `enc:${v}`),
      decrypt: jest.fn(),
    };
    const auditService = { log: jest.fn(), setActorId: jest.fn() };
    const service = new SsoService(
      db as any,
      { findById: jest.fn().mockResolvedValue({ id: workspaceId, hostname: 'tenant' }) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { getUrl: jest.fn().mockReturnValue('https://tenant.example.com') } as any,
      cryptoService as any,
      { getOrThrow: jest.fn().mockReturnValue({}) } as any,
      auditService as any,
    );

    return { service, db, cryptoService, auditService, providerRow,
      getInserted: () => insertedValues,
      getUpdated: () => updatedValues,
    };
  }

  it('encrypts the client secret and never returns or audits it', async () => {
    const ctx = createSocialHarness();

    const result = await ctx.service.createProvider(workspaceId, 'creator-1', {
      type: 'github',
      name: 'GitHub',
      clientId: 'client-id',
      clientSecret: 'super-secret',
      isEnabled: false,
    } as any);

    expect(ctx.cryptoService.encrypt).toHaveBeenCalledWith('super-secret');
    expect(ctx.getInserted()).toMatchObject({
      type: 'github',
      oidcClientSecret: 'enc:super-secret',
    });
    expect(JSON.stringify(result)).not.toContain('super-secret');
    expect(result).not.toHaveProperty('oidcClientSecret');
    expect(result.hasClientSecret).toBe(true);
    expect(result.callbackUrl).toBe(
      'https://tenant.example.com/api/auth/social/github/callback',
    );
    const auditPayload = JSON.stringify(ctx.auditService.log.mock.calls);
    expect(auditPayload).not.toContain('super-secret');
    expect(auditPayload).not.toContain('enc:super-secret');
  });

  it('refuses to enable a provider without complete credentials', async () => {
    const ctx = createSocialHarness();

    await expect(
      ctx.service.createProvider(workspaceId, 'creator-1', {
        type: 'google',
        name: 'Google',
        clientId: 'client-id',
        isEnabled: true,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps a duplicate social provider to a readable error', async () => {
    const ctx = createSocialHarness({ insertError: { code: '23505' } });

    await expect(
      ctx.service.createProvider(workspaceId, 'creator-1', {
        type: 'github',
        name: 'GitHub',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps the stored secret when the update omits it', async () => {
    const ctx = createSocialHarness();

    await ctx.service.updateProvider(workspaceId, {
      providerId,
      isEnabled: true,
    } as any);

    expect(ctx.getUpdated()).not.toHaveProperty('oidcClientSecret');
    expect(ctx.cryptoService.encrypt).not.toHaveBeenCalled();
  });

  function chainReturning(row: unknown): any {
    const chain: any = {
      selectAll: () => chain,
      select: () => chain,
      where: () => chain,
      orderBy: () => chain,
      executeTakeFirst: jest.fn().mockResolvedValue(row),
      execute: jest.fn().mockResolvedValue(row ? [row] : []),
    };
    return chain;
  }

  it('refuses to enable via update when no secret is configured', async () => {
    const ctx = createSocialHarness();
    ctx.db.selectFrom.mockReturnValue(
      chainReturning({ ...ctx.providerRow, oidcClientSecret: null }),
    );

    await expect(
      ctx.service.updateProvider(workspaceId, {
        providerId,
        isEnabled: true,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('strips secrets from serialized SAML providers too', async () => {
    const ctx = createSocialHarness();
    ctx.db.selectFrom.mockReturnValue(
      chainReturning({
        ...ctx.providerRow,
        type: 'saml',
        oidcClientSecret: 'legacy-plain',
        ldapBindPassword: 'ldap-pass',
      }),
    );

    const result = await ctx.service.getProvider(workspaceId, {
      providerId,
    } as any);

    expect(result).not.toHaveProperty('oidcClientSecret');
    expect(result).not.toHaveProperty('ldapBindPassword');
    expect(JSON.stringify(result)).not.toContain('legacy-plain');
    expect(JSON.stringify(result)).not.toContain('ldap-pass');
  });
});
