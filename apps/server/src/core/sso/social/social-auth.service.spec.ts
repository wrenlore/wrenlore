import { SocialAuthFlowError } from './social-auth.service';
import {
  createService,
  makeWorkspace,
  makeUser,
  githubProviderRow,
  identity,
  providerId,
  workspaceId,
  userId,
  browserBinding,
  sessionToken,
  baseUrl,
} from './social-auth.test-fixture';

describe('SocialAuthService', () => {
  describe('startLogin', () => {
    it('rejects when the provider is disabled', async () => {
      const ctx = createService();
      ctx.db.queueSelect(
        'authProviders',
        githubProviderRow({ isEnabled: false }),
      );

      await expect(
        ctx.service.startLogin(makeWorkspace(), 'github', browserBinding),
      ).rejects.toThrow(SocialAuthFlowError);
      await expect(
        ctx.service.startLogin(makeWorkspace(), 'github', browserBinding),
      ).rejects.toMatchObject({ code: 'provider_disabled' });
    });

    it('rejects when the provider is not fully configured', async () => {
      const ctx = createService();
      ctx.db.queueSelect(
        'authProviders',
        githubProviderRow({ oidcClientSecret: null }),
      );

      await expect(
        ctx.service.startLogin(makeWorkspace(), 'github', browserBinding),
      ).rejects.toMatchObject({ code: 'provider_not_configured' });
    });

    it('rejects when the workspace enforces SAML SSO', async () => {
      const ctx = createService();
      ctx.db.queueSelect('authProviders', githubProviderRow());

      await expect(
        ctx.service.startLogin(
          makeWorkspace({ enforceSso: true }),
          'github',
          browserBinding,
        ),
      ).rejects.toMatchObject({ code: 'sso_enforced' });
    });

    it('stores a single-use state and starts the GitHub flow with PKCE', async () => {
      const ctx = createService();
      ctx.db.queueSelect('authProviders', githubProviderRow());

      const url = await ctx.service.startLogin(
        makeWorkspace(),
        'github',
        browserBinding,
      );
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
      expect(parsed.codeVerifier).toHaveLength(43);
      expect(parsed.browserBindingHash).toBeTruthy();
      expect(stored).not.toContain(browserBinding);
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

      const url = await ctx.service.startLogin(
        makeWorkspace(),
        'google',
        browserBinding,
      );
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
        browserBinding,
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
        browserBinding,
      );
      const state = new URL(url).searchParams.get('state') as string;
      return { ctx, state };
    }

    function callback(ctx: ReturnType<typeof createService>, state: string) {
      return ctx.service.handleCallback({
        browserBinding,
        sessionToken,
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
          browserBinding,
          sessionToken,
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
          browserBinding,
          sessionToken,
          workspace: makeWorkspace(),
          type: 'google',
          query: { code: 'code-123', state },
        }),
      ).rejects.toMatchObject({ code: 'state_invalid' });
    });

    it('blocks in-flight callbacks when the provider gets disabled', async () => {
      const { ctx, state } = await prepareLogin();
      ctx.db.queueSelect(
        'authProviders',
        githubProviderRow({ isEnabled: false }),
      );

      await expect(callback(ctx, state)).rejects.toMatchObject({
        code: 'provider_disabled',
      });
    });

    it('blocks in-flight logins when SSO enforcement is turned on', async () => {
      const { ctx, state } = await prepareLogin();
      ctx.db.queueSelect('authProviders', githubProviderRow());

      await expect(
        ctx.service.handleCallback({
          browserBinding,
          sessionToken,
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
      ctx.db.queueSelect(
        'authProviders',
        githubProviderRow({ allowSignup: true }),
      );
      ctx.db.queueSelect('authAccounts', null);
      ctx.userRepo.findByEmail.mockResolvedValue(makeUser());

      await expect(callback(ctx, state)).rejects.toMatchObject({
        code: 'account_not_linked',
      });
      expect(
        ctx.db.inserted.filter((i) => i.table === 'authAccounts'),
      ).toHaveLength(0);
    });

    it('rejects signup when the provider does not allow it', async () => {
      const { ctx, state } = await prepareLogin();
      ctx.db.queueSelect(
        'authProviders',
        githubProviderRow({ allowSignup: false }),
      );
      ctx.db.queueSelect('authAccounts', null);

      await expect(callback(ctx, state)).rejects.toMatchObject({
        code: 'signup_not_allowed',
      });
    });

    it('rejects signup without a provider-verified email', async () => {
      const { ctx, state } = await prepareLogin();
      ctx.db.queueSelect(
        'authProviders',
        githubProviderRow({ allowSignup: true }),
      );
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
      ctx.db.queueSelect(
        'authProviders',
        githubProviderRow({ allowSignup: true }),
      );
      ctx.db.queueSelect('authAccounts', null);

      await expect(
        ctx.service.handleCallback({
          browserBinding,
          sessionToken,
          workspace: makeWorkspace({ emailDomains: ['corp.example.com'] }),
          type: 'github',
          query: { code: 'code-123', state },
        }),
      ).rejects.toMatchObject({ code: 'domain_not_allowed' });
    });

    it('rejects cloud signup without an invitation', async () => {
      const { ctx, state } = await prepareLogin({ cloud: true });
      ctx.db.queueSelect(
        'authProviders',
        githubProviderRow({ allowSignup: true }),
      );
      ctx.db.queueSelect('authAccounts', null);
      ctx.db.queueSelect('workspaceInvitations', undefined);

      await expect(callback(ctx, state)).rejects.toMatchObject({
        code: 'signup_not_allowed',
      });
    });

    it('creates a verified account when signup is allowed', async () => {
      const { ctx, state } = await prepareLogin();
      ctx.db.queueSelect(
        'authProviders',
        githubProviderRow({ allowSignup: true }),
      );
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
      ctx.db.queueSelect(
        'authProviders',
        githubProviderRow({ allowSignup: true }),
      );
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
        browserBinding,
        sessionToken,
      );
      const state = new URL(url).searchParams.get('state') as string;
      return { ctx, state };
    }

    it('links the identity to the authenticated user', async () => {
      const { ctx, state } = await prepareLink();
      ctx.db.queueSelect('authProviders', githubProviderRow());
      ctx.db.queueSelect('authAccounts', null);

      const result = await ctx.service.handleCallback({
        browserBinding,
        sessionToken,
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
          browserBinding,
          sessionToken,
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
        browserBinding,
        sessionToken,
        workspace: makeWorkspace(),
        type: 'github',
        query: { code: 'code-123', state },
      });

      expect(result.kind).toBe('linked');
      expect(
        ctx.db.inserted.filter((i) => i.table === 'authAccounts'),
      ).toHaveLength(0);
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
          ([payload]: any[]) => payload.event === 'user.auth_account_unlinked',
        ),
      ).toBe(true);
    });
  });
});

describe('Social authentication review regressions', () => {
  async function login(
    ctx: ReturnType<typeof createService>,
    overrides: any = {},
  ) {
    ctx.db.queueSelect(
      'authProviders',
      githubProviderRow(),
      githubProviderRow(),
    );
    ctx.db.queueSelect('authAccounts', { userId, providerUserId: 'gh-123' });
    const url = await ctx.service.startLogin(
      makeWorkspace(),
      'github',
      browserBinding,
    );
    const state = new URL(url).searchParams.get('state')!;
    return ctx.service.handleCallback({
      workspace: makeWorkspace(),
      type: 'github',
      query: { code: 'code', state },
      browserBinding,
      ...overrides,
    });
  }

  it.each([
    ['different@example.net', true, false],
    ['USER@EXAMPLE.COM', true, true],
    ['user@example.com', false, false],
    [null, true, false],
  ])(
    'only verifies the exact provider-verified local address (%s, %s)',
    async (email, verified, shouldVerify) => {
      const ctx = createService();
      ctx.userRepo.findById.mockResolvedValue(
        makeUser({ emailVerifiedAt: null }),
      );
      ctx.githubDriver.resolveIdentity.mockResolvedValue(
        identity({ email, emailVerified: verified }),
      );
      await login(ctx);
      const verifiedWrites = ctx.userRepo.updateUser.mock.calls.filter(
        ([data]) => data.emailVerifiedAt,
      );
      expect(verifiedWrites).toHaveLength(shouldVerify ? 1 : 0);
    },
  );

  it('does not record login success or lastLoginAt until MFA succeeds', async () => {
    const ctx = createService();
    ctx.instanceSettingRepo.isLocalMfaRequired.mockResolvedValue(true);
    ctx.userMfaRepo.findByUserId.mockResolvedValue({
      enabledAt: new Date(),
      totpSecret: 'encrypted',
    });
    expect((await login(ctx)).kind).toBe('mfa');
    expect(ctx.userRepo.updateLastLogin).not.toHaveBeenCalled();
    expect(
      ctx.auditService.log.mock.calls.some(
        ([event]) => event.event === 'user.login',
      ),
    ).toBe(false);
    expect(ctx.tokenService.generateMfaToken).toHaveBeenCalledWith(
      expect.anything(),
      workspaceId,
      { source: 'github', providerId },
    );
  });

  it('records exactly one successful non-MFA login with the human actor and provider', async () => {
    const ctx = createService();
    await login(ctx);
    expect(ctx.userRepo.updateLastLogin).toHaveBeenCalledTimes(1);
    expect(ctx.auditService.setActorId).toHaveBeenCalledWith(userId);
    expect(
      ctx.auditService.log.mock.calls.filter(
        ([event]) => event.event === 'user.login',
      ),
    ).toEqual([
      [
        expect.objectContaining({
          metadata: { source: 'github', providerId, workspaceId },
        }),
      ],
    ]);
  });

  it('disables account-link controls while enterprise SSO is enforced', async () => {
    const ctx = createService();
    expect(
      (
        await ctx.service.listAccounts(
          makeUser(),
          makeWorkspace({ enforceSso: true }),
        )
      ).linkingAllowed,
    ).toBe(false);
  });
});
