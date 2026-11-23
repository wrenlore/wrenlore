import { SocialAuthService, SocialAuthFlowError } from './social-auth.service';

const providerId = '019e6a1c-3969-704e-b0fb-57549f2cb3ef';
const workspaceId = '019e6a1c-3969-704e-b0fb-57549f2cb3ee';
const userId = '019e6a1c-3969-704e-b0fb-57549f2cb3ef';
const baseUrl = 'https://tenant.example.com';

class FakeRedis {
  private nowMs = 0;
  readonly entries = new Map<string, { value: string; expiresAt: number }>();

  async set(key: string, value: string, ...args: unknown[]) {
    const pxIndex = args.indexOf('PX');
    const ttlMs =
      pxIndex >= 0 && typeof args[pxIndex + 1] === 'number'
        ? (args[pxIndex + 1] as number)
        : 60_000;
    if (args.includes('NX') && (await this.get(key)) !== null) {
      return null;
    }
    this.entries.set(key, { value, expiresAt: this.nowMs + ttlMs });
    return 'OK';
  }

  async get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.nowMs) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async getdel(key: string) {
    const value = await this.get(key);
    this.entries.delete(key);
    return value;
  }

  advanceBy(ms: number) {
    this.nowMs += ms;
  }
}

class FakeDb {
  private selectQueues: Record<string, unknown[]> = {};
  readonly inserted: { table: string; values: any }[] = [];
  readonly updated: { table: string; values: any }[] = [];
  insertConflicts = false;

  queueSelect(table: string, ...results: unknown[]) {
    (this.selectQueues[table] ??= []).push(...results);
  }

  private nextSelect(table: string, terminal: string) {
    const queue = this.selectQueues[table] ?? [];
    if (terminal === 'execute') {
      return queue.length ? (queue.shift() as unknown[]) ?? [] : [];
    }
    return queue.length ? queue.shift() : undefined;
  }

  private chain(table: string, kind: 'select' | 'insert' | 'update'): any {
    const self = this;
    let values: any = {};

    const target: any = {
      selectAll: () => target,
      select: () => target,
      innerJoin: () => target,
      where: () => target,
      orderBy: () => target,
      set: (v: any) => {
        values = v;
        return target;
      },
      values: (v: any) => {
        values = v;
        return target;
      },
      onConflict: (cb?: (oc: any) => unknown) => {
        cb?.(target);
        return target;
      },
      doNothing: () => target,
      returning: () => target,
      returningAll: () => target,
      executeTakeFirst: async () => {
        if (kind === 'select') return self.nextSelect(table, 'first');
        if (kind === 'insert') {
          self.inserted.push({ table, values });
          return self.insertConflicts ? undefined : { id: 'link-id' };
        }
        self.updated.push({ table, values });
        return { id: 'row-id', ...values };
      },
      executeTakeFirstOrThrow: async () => {
        const row = await target.executeTakeFirst();
        if (!row) throw new Error('no row');
        return row;
      },
      execute: async () => {
        if (kind === 'select') return self.nextSelect(table, 'execute');
        if (kind === 'insert') {
          self.inserted.push({ table, values });
          return [];
        }
        self.updated.push({ table, values });
        return [{ numUpdatedRows: 1n }];
      },
    };
    return target;
  }

  selectFrom = (table: string) => this.chain(table, 'select');
  insertInto = (table: string) => this.chain(table, 'insert');
  updateTable = (table: string) => this.chain(table, 'update');
  transaction = () => ({
    execute: async (cb: any) => cb(this),
  });
}

function githubProviderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: providerId,
    workspaceId,
    type: 'github',
    name: 'GitHub',
    isEnabled: true,
    allowSignup: false,
    oidcClientId: 'client-id',
    oidcClientSecret: 'enc:secret',
    deletedAt: null,
    ...overrides,
  };
}

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: workspaceId,
    hostname: 'tenant',
    enforceSso: false,
    emailDomains: [],
    ...overrides,
  } as any;
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: userId,
    email: 'user@example.com',
    name: 'User',
    workspaceId,
    deactivatedAt: null,
    deletedAt: null,
    emailVerifiedAt: new Date(),
    ...overrides,
  } as any;
}

function identity(overrides: Record<string, unknown> = {}) {
  return {
    providerUserId: 'gh-123',
    email: 'user@example.com',
    emailVerified: true,
    displayName: 'User',
    ...overrides,
  };
}

function createService(options: { provider?: any; cloud?: boolean } = {}) {
  const db = new FakeDb();
  const redis = new FakeRedis();

  const userRepo = {
    findById: jest.fn().mockResolvedValue(makeUser()),
    findByEmail: jest.fn().mockResolvedValue(null),
    insertUser: jest.fn().mockImplementation(async (data: any) => ({
      id: 'new-user-id',
      ...data,
    })),
    updateUser: jest.fn().mockResolvedValue(undefined),
  };
  const userMfaRepo = { findByUserId: jest.fn().mockResolvedValue(null) };
  const instanceSettingRepo = {
    isLocalMfaRequired: jest.fn().mockResolvedValue(false),
  };
  const groupUserRepo = { addUserToDefaultGroup: jest.fn() };
  const workspaceService = { addUserToWorkspace: jest.fn() };
  const tokenService = {
    generateAccessToken: jest.fn().mockResolvedValue('auth-token'),
    generateMfaToken: jest.fn().mockResolvedValue('mfa-token'),
  };
  const mfaService = {
    decryptTotpSecret: jest.fn().mockReturnValue('totp-secret'),
  };
  const domainService = { getUrl: jest.fn().mockReturnValue(baseUrl) };
  const environmentService = {
    isHttps: jest.fn().mockReturnValue(true),
    getCookieExpiresIn: jest.fn().mockReturnValue(new Date()),
    isCloud: jest.fn().mockReturnValue(options.cloud ?? false),
  };
  const cryptoService = {
    encrypt: jest.fn((value: string) => `enc:${value}`),
    decrypt: jest.fn((value: string) =>
      value.startsWith('enc:') ? value.slice(4) : value,
    ),
  };
  const githubDriver = {
    type: 'github',
    buildAuthorizeUrl: jest
      .fn()
      .mockImplementation(async ({ state }: any) => ({
        authorizeUrl: `https://github.com/login/oauth/authorize?state=${state}&client_id=client-id&scope=read:user+user:email`,
      })),
    resolveIdentity: jest.fn().mockResolvedValue(identity()),
  };
  const googleDriver = {
    type: 'google',
    buildAuthorizeUrl: jest
      .fn()
      .mockImplementation(async ({ state }: any) => ({
        authorizeUrl: `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
      })),
    resolveIdentity: jest.fn().mockResolvedValue(identity()),
  };
  const auditService = { log: jest.fn(), setActorId: jest.fn() };
  const redisService = { getOrThrow: jest.fn().mockReturnValue(redis) };

  const service = new SocialAuthService(
    db as any,
    userRepo as any,
    userMfaRepo as any,
    instanceSettingRepo as any,
    groupUserRepo as any,
    workspaceService as any,
    tokenService as any,
    mfaService as any,
    domainService as any,
    environmentService as any,
    cryptoService as any,
    githubDriver as any,
    googleDriver as any,
    auditService as any,
    redisService as any,
  );

  return {
    service,
    db,
    redis,
    userRepo,
    userMfaRepo,
    instanceSettingRepo,
    groupUserRepo,
    workspaceService,
    tokenService,
    mfaService,
    environmentService,
    cryptoService,
    githubDriver,
    googleDriver,
    auditService,
  };
}

describe('SocialAuthService', () => {
  describe('startLogin', () => {
    it('rejects when the provider is disabled', async () => {
      const ctx = createService();
      ctx.db.queueSelect(
        'authProviders',
        githubProviderRow({ isEnabled: false }),
      );

      await expect(
        ctx.service.startLogin(makeWorkspace(), 'github'),
      ).rejects.toThrow(SocialAuthFlowError);
      await expect(
        ctx.service.startLogin(makeWorkspace(), 'github'),
      ).rejects.toMatchObject({ code: 'provider_disabled' });
    });

    it('rejects when the provider is not fully configured', async () => {
      const ctx = createService();
      ctx.db.queueSelect(
        'authProviders',
        githubProviderRow({ oidcClientSecret: null }),
      );

      await expect(
        ctx.service.startLogin(makeWorkspace(), 'github'),
      ).rejects.toMatchObject({ code: 'provider_not_configured' });
    });

    it('rejects when the workspace enforces SAML SSO', async () => {
      const ctx = createService();
      ctx.db.queueSelect('authProviders', githubProviderRow());

      await expect(
        ctx.service.startLogin(makeWorkspace({ enforceSso: true }), 'github'),
      ).rejects.toMatchObject({ code: 'sso_enforced' });
    });

    it('stores a single-use state and starts the GitHub flow without PKCE', async () => {
      const ctx = createService();
      ctx.db.queueSelect('authProviders', githubProviderRow());

      const url = await ctx.service.startLogin(makeWorkspace(), 'github');
      const state = new URL(url).searchParams.get('state') as string;
      expect(state).toBeTruthy();

      const stored = await ctx.redis.get(`sso:social:state:${state}`);
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored as string);
      expect(parsed).toMatchObject({
        workspaceId,
        providerId,
        providerType: 'github',
        operation: 'login',
      });
      expect(parsed.codeVerifier).toBeUndefined();
      expect(ctx.githubDriver.buildAuthorizeUrl).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'client-id' }),
      );
    });

    it('uses PKCE S256 and a nonce for Google', async () => {
      const ctx = createService();
      ctx.db.queueSelect(
        'authProviders',
        githubProviderRow({ type: 'google' }),
      );

      const url = await ctx.service.startLogin(makeWorkspace(), 'google');
      const state = new URL(url).searchParams.get('state') as string;
      const parsed = JSON.parse(
        (await ctx.redis.get(`sso:social:state:${state}`)) as string,
      );
      expect(parsed.codeVerifier).toBeTruthy();
      expect(parsed.nonce).toBeTruthy();
    });

    it('rejects redirect targets outside the workspace origin', async () => {
      const ctx = createService();
      ctx.db.queueSelect('authProviders', githubProviderRow());

      const url = await ctx.service.startLogin(
        makeWorkspace(),
        'github',
        'https://evil.example.com/steal',
      );
      const state = new URL(url).searchParams.get('state') as string;
      const parsed = JSON.parse(
        (await ctx.redis.get(`sso:social:state:${state}`)) as string,
      );
      expect(parsed.redirect).toBeNull();
    });
  });

  describe('handleCallback (login)', () => {
    async function prepareLogin(
      options: {
        provider?: any;
        workspace?: any;
        cloud?: boolean;
      } = {},
    ) {
      const ctx = createService({ cloud: options.cloud });
      const provider = options.provider ?? githubProviderRow();
      ctx.db.queueSelect('authProviders', provider);
      const url = await ctx.service.startLogin(
        options.workspace ?? makeWorkspace(),
        'github',
      );
      const state = new URL(url).searchParams.get('state') as string;
      return { ctx, state };
    }

    function callback(ctx: ReturnType<typeof createService>, state: string) {
      return ctx.service.handleCallback({
        workspace: makeWorkspace(),
        type: 'github',
        query: { code: 'code-123', state },
      });
    }

    it('rejects an expired or unknown state', async () => {
      const { ctx } = await prepareLogin();

      await expect(callback(ctx, 'unknown-state')).rejects.toMatchObject({
        code: 'state_invalid',
      });
    });

    it('rejects a replayed state (single use)', async () => {
      const { ctx, state } = await prepareLogin();
      ctx.db.queueSelect('authProviders', githubProviderRow());
      ctx.db.queueSelect('authAccounts', { userId, providerUserId: 'gh-123' });

      const result = await callback(ctx, state);
      expect(result.kind).toBe('session');

      await expect(callback(ctx, state)).rejects.toMatchObject({
        code: 'state_invalid',
      });
    });

    it('rejects a state bound to another workspace', async () => {
      const { ctx, state } = await prepareLogin();

      await expect(
        ctx.service.handleCallback({
          workspace: { ...makeWorkspace(), id: 'other-workspace' },
          type: 'github',
          query: { code: 'code-123', state },
        }),
      ).rejects.toMatchObject({ code: 'state_invalid' });
    });

    it('rejects a state created for another provider type', async () => {
      const { ctx, state } = await prepareLogin();

      await expect(
        ctx.service.handleCallback({
          workspace: makeWorkspace(),
          type: 'google',
          query: { code: 'code-123', state },
        }),
      ).rejects.toMatchObject({ code: 'state_invalid' });
    });

    it('blocks in-flight callbacks when the provider gets disabled', async () => {
      const { ctx, state } = await prepareLogin();
      ctx.db.queueSelect('authProviders', githubProviderRow({ isEnabled: false }));

      await expect(callback(ctx, state)).rejects.toMatchObject({
        code: 'provider_disabled',
      });
    });

    it('blocks in-flight logins when SSO enforcement is turned on', async () => {
      const { ctx, state } = await prepareLogin();
      ctx.db.queueSelect('authProviders', githubProviderRow());

      await expect(
        ctx.service.handleCallback({
          workspace: makeWorkspace({ enforceSso: true }),
          type: 'github',
          query: { code: 'code-123', state },
        }),
      ).rejects.toMatchObject({ code: 'sso_enforced' });
    });

    it('fails safely when the provider identity cannot be verified', async () => {
      const { ctx, state } = await prepareLogin();
      ctx.db.queueSelect('authProviders', githubProviderRow());
      ctx.githubDriver.resolveIdentity.mockRejectedValue(
        new Error('bad id_token'),
      );

      await expect(callback(ctx, state)).rejects.toMatchObject({
        code: 'identity_failed',
      });
      // Failure audit must not contain tokens or codes.
      const failure = ctx.auditService.log.mock.calls.find(
        ([payload]: any[]) => payload.event === 'user.login_failed',
      );
      expect(failure).toBeTruthy();
      expect(JSON.stringify(failure)).not.toContain('code-123');
    });

    it('logs in an existing linked user and audits the login', async () => {
      const { ctx, state } = await prepareLogin();
      ctx.db.queueSelect('authProviders', githubProviderRow());
      ctx.db.queueSelect('authAccounts', {
        userId,
        providerUserId: 'gh-123',
        workspaceId,
      });

      const result = await callback(ctx, state);

      expect(result).toMatchObject({
        kind: 'session',
        authToken: 'auth-token',
        redirectUrl: `${baseUrl}/home`,
      });
      expect(ctx.userRepo.findByEmail).not.toHaveBeenCalled();
      expect(ctx.auditService.setActorId).toHaveBeenCalledWith(userId);
      const loginAudit = ctx.auditService.log.mock.calls.find(
        ([payload]: any[]) => payload.event === 'user.login',
      );
      expect(loginAudit?.[0].metadata).toMatchObject({ source: 'github' });
    });

    it('rejects a disabled linked user', async () => {
      const { ctx, state } = await prepareLogin();
      ctx.db.queueSelect('authProviders', githubProviderRow());
      ctx.db.queueSelect('authAccounts', { userId, providerUserId: 'gh-123' });
      ctx.userRepo.findById.mockResolvedValue(
        makeUser({ deactivatedAt: new Date() }),
      );

      await expect(callback(ctx, state)).rejects.toMatchObject({
        code: 'account_disabled',
      });
    });

    it('never silently links by email match', async () => {
      const { ctx, state } = await prepareLogin();
      ctx.db.queueSelect('authProviders', githubProviderRow({ allowSignup: true }));
      ctx.db.queueSelect('authAccounts', null);
      ctx.userRepo.findByEmail.mockResolvedValue(makeUser());

      await expect(callback(ctx, state)).rejects.toMatchObject({
        code: 'account_not_linked',
      });
      expect(ctx.db.inserted.filter((i) => i.table === 'authAccounts')).toHaveLength(0);
    });

    it('rejects signup when the provider does not allow it', async () => {
      const { ctx, state } = await prepareLogin();
      ctx.db.queueSelect('authProviders', githubProviderRow({ allowSignup: false }));
      ctx.db.queueSelect('authAccounts', null);

      await expect(callback(ctx, state)).rejects.toMatchObject({
        code: 'signup_not_allowed',
      });
    });

    it('rejects signup without a provider-verified email', async () => {
      const { ctx, state } = await prepareLogin();
      ctx.db.queueSelect('authProviders', githubProviderRow({ allowSignup: true }));
      ctx.db.queueSelect('authAccounts', null);
      ctx.githubDriver.resolveIdentity.mockResolvedValue(
        identity({ emailVerified: false }),
      );

      await expect(callback(ctx, state)).rejects.toMatchObject({
        code: 'email_unverified',
      });
    });

    it('rejects signup for a domain outside the workspace allowlist', async () => {
      const { ctx, state } = await prepareLogin();
      ctx.db.queueSelect('authProviders', githubProviderRow({ allowSignup: true }));
      ctx.db.queueSelect('authAccounts', null);

      await expect(
        ctx.service.handleCallback({
          workspace: makeWorkspace({ emailDomains: ['corp.example.com'] }),
          type: 'github',
          query: { code: 'code-123', state },
        }),
      ).rejects.toMatchObject({ code: 'domain_not_allowed' });
    });

    it('rejects cloud signup without an invitation', async () => {
      const { ctx, state } = await prepareLogin({ cloud: true });
      ctx.db.queueSelect('authProviders', githubProviderRow({ allowSignup: true }));
      ctx.db.queueSelect('authAccounts', null);
      ctx.db.queueSelect('workspaceInvitations', undefined);

      await expect(callback(ctx, state)).rejects.toMatchObject({
        code: 'signup_not_allowed',
      });
    });

    it('creates a verified account when signup is allowed', async () => {
      const { ctx, state } = await prepareLogin();
      ctx.db.queueSelect('authProviders', githubProviderRow({ allowSignup: true }));
      ctx.db.queueSelect('authAccounts', null);

      const result = await callback(ctx, state);

      expect(result.kind).toBe('session');
      expect(ctx.userRepo.insertUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'user@example.com',
          emailVerifiedAt: expect.any(Date),
          hasGeneratedPassword: true,
        }),
        expect.anything(),
      );
      expect(ctx.workspaceService.addUserToWorkspace).toHaveBeenCalled();
      expect(ctx.groupUserRepo.addUserToDefaultGroup).toHaveBeenCalled();
      const link = ctx.db.inserted.find((i) => i.table === 'authAccounts');
      expect(link?.values).toMatchObject({
        userId: 'new-user-id',
        providerUserId: 'gh-123',
        authProviderId: providerId,
      });
    });

    it('reports a link collision when the identity raced to another account', async () => {
      const { ctx, state } = await prepareLogin();
      ctx.db.queueSelect('authProviders', githubProviderRow({ allowSignup: true }));
      ctx.db.queueSelect('authAccounts', null);
      ctx.db.insertConflicts = true;

      await expect(callback(ctx, state)).rejects.toMatchObject({
        code: 'link_collision',
      });
    });

    it('routes through the MFA challenge when MFA is enrolled', async () => {
      const { ctx, state } = await prepareLogin();
      ctx.db.queueSelect('authProviders', githubProviderRow());
      ctx.db.queueSelect('authAccounts', { userId, providerUserId: 'gh-123' });
      ctx.instanceSettingRepo.isLocalMfaRequired.mockResolvedValue(true);
      ctx.userMfaRepo.findByUserId.mockResolvedValue({
        enabledAt: new Date(),
        totpSecret: 'enc:totp',
      });

      const result = await callback(ctx, state);

      expect(result.kind).toBe('mfa');
      expect(result).toMatchObject({
        redirectUrl: `${baseUrl}/login/mfa#mfa_token=mfa-token`,
      });
      expect(ctx.tokenService.generateAccessToken).not.toHaveBeenCalled();
    });

    it('requires MFA setup when MFA is enforced but not enrolled', async () => {
      const { ctx, state } = await prepareLogin();
      ctx.db.queueSelect('authProviders', githubProviderRow());
      ctx.db.queueSelect('authAccounts', { userId, providerUserId: 'gh-123' });
      ctx.instanceSettingRepo.isLocalMfaRequired.mockResolvedValue(true);

      const result = await callback(ctx, state);

      expect(result).toMatchObject({
        kind: 'session',
        requiresMfaSetup: true,
        redirectUrl: `${baseUrl}/login/mfa/setup`,
      });
    });
  });

  describe('handleCallback (link)', () => {
    async function prepareLink() {
      const ctx = createService();
      ctx.db.queueSelect('authProviders', githubProviderRow());
      const url = await ctx.service.startLink(
        makeUser(),
        makeWorkspace(),
        'github',
      );
      const state = new URL(url).searchParams.get('state') as string;
      return { ctx, state };
    }

    it('links the identity to the authenticated user', async () => {
      const { ctx, state } = await prepareLink();
      ctx.db.queueSelect('authProviders', githubProviderRow());
      ctx.db.queueSelect('authAccounts', null);

      const result = await ctx.service.handleCallback({
        workspace: makeWorkspace(),
        type: 'github',
        query: { code: 'code-123', state },
      });

      expect(result).toMatchObject({
        kind: 'linked',
        redirectUrl: `${baseUrl}/settings/account?social=connected`,
      });
      const link = ctx.db.inserted.find((i) => i.table === 'authAccounts');
      expect(link?.values).toMatchObject({ userId, providerUserId: 'gh-123' });
      expect(
        ctx.auditService.log.mock.calls.some(
          ([payload]: any[]) => payload.event === 'user.auth_account_linked',
        ),
      ).toBe(true);
    });

    it('rejects linking an identity already connected to another account', async () => {
      const { ctx, state } = await prepareLink();
      ctx.db.queueSelect('authProviders', githubProviderRow());
      ctx.db.queueSelect('authAccounts', {
        userId: 'someone-else',
        providerUserId: 'gh-123',
      });

      await expect(
        ctx.service.handleCallback({
          workspace: makeWorkspace(),
          type: 'github',
          query: { code: 'code-123', state },
        }),
      ).rejects.toMatchObject({ code: 'link_collision' });
    });

    it('is idempotent when the identity is already linked to this user', async () => {
      const { ctx, state } = await prepareLink();
      ctx.db.queueSelect('authProviders', githubProviderRow());
      ctx.db.queueSelect('authAccounts', { userId, providerUserId: 'gh-123' });

      const result = await ctx.service.handleCallback({
        workspace: makeWorkspace(),
        type: 'github',
        query: { code: 'code-123', state },
      });

      expect(result.kind).toBe('linked');
      expect(ctx.db.inserted.filter((i) => i.table === 'authAccounts')).toHaveLength(
        0,
      );
    });
  });

  describe('unlink', () => {
    it('soft-deletes the link and audits the change', async () => {
      const ctx = createService();
      ctx.db.queueSelect('authProviders', githubProviderRow());

      await ctx.service.unlink(makeUser(), makeWorkspace(), 'github');

      const update = ctx.db.updated.find((u) => u.table === 'authAccounts');
      expect(update?.values.deletedAt).toBeInstanceOf(Date);
      expect(
        ctx.auditService.log.mock.calls.some(
          ([payload]: any[]) =>
            payload.event === 'user.auth_account_unlinked',
        ),
      ).toBe(true);
    });
  });
});
