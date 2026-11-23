/**
 * Integration coverage for the social login flow against a real PostgreSQL
 * and Redis, with the provider HTTP endpoints mocked at the fetch boundary.
 *
 * Opt-in: requires SOCIAL_INTEGRATION_DB and SOCIAL_INTEGRATION_REDIS.
 * Example:
 *   SOCIAL_INTEGRATION_DB="postgresql://postgres:wr@localhost:54331/wrsocial" \
 *   SOCIAL_INTEGRATION_REDIS=redis://localhost:6381 \
 *   pnpm exec jest social-auth.integration
 */
import { CamelCasePlugin, Kysely } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import Redis from 'ioredis';

// The postgres driver is ESM-first; resolve it in a CJS-compatible way.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const postgresModule = require('postgres');
const postgres = postgresModule.default ?? postgresModule;
import { HttpStatus } from '@nestjs/common';
import { UserRepo } from '@wrenlore/db/repos/user/user.repo';
import { GroupRepo } from '@wrenlore/db/repos/group/group.repo';
import { GroupUserRepo } from '@wrenlore/db/repos/group/group-user.repo';
import { InstanceSettingRepo } from '@wrenlore/db/repos/instance-setting/instance-setting.repo';
import { AppSecretCryptoService } from '../../../common/crypto/app-secret-crypto.service';
import { SsoService } from '../sso.service';
import { SocialAuthService } from './social-auth.service';
import { SocialAuthController } from './social-auth.controller';
import { GithubOauthProvider } from './providers/github-oauth.provider';
import { GoogleOidcProvider } from './providers/google-oidc.provider';

const describeIf =
  process.env.SOCIAL_INTEGRATION_DB && process.env.SOCIAL_INTEGRATION_REDIS
    ? describe
    : describe.skip;

const HOSTNAME = 'socialtest';
const APP_URL = 'https://socialtest.example.com';

describeIf('Social auth integration (real db + redis, mocked provider endpoints)', () => {
  let db: Kysely<any>;
  let redis: Redis;
  let workspaceId: string;
  let socialService: SocialAuthService;
  let ssoService: SsoService;
  let githubProvider: GithubOauthProvider;
  let auditCalls: any[];
  let audit: { log: jest.Mock; setActorId: jest.Mock };

  const auditService = () => audit;

  function makeWorkspace(overrides: Record<string, unknown> = {}) {
    return {
      id: workspaceId,
      hostname: HOSTNAME,
      enforceSso: false,
      emailDomains: [],
      ...overrides,
    } as any;
  }

  function mockGithubEndpoints(opts: {
    githubUserId: number;
    email: string;
    verified?: boolean;
  }) {
    const fetchMock = jest.fn(async (input: string, init?: any) => {
      if (input.includes('/login/oauth/access_token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: `ghp_${opts.githubUserId}` }),
        };
      }
      if (input.includes('/user/emails')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              email: opts.email,
              verified: opts.verified ?? true,
              primary: true,
            },
          ],
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: opts.githubUserId,
          login: `user${opts.githubUserId}`,
          name: `User ${opts.githubUserId}`,
          email: opts.email,
        }),
      };
    });
    (githubProvider as any).fetchImpl = fetchMock;
    return fetchMock;
  }

  function fakeReply() {
    const reply: any = {
      statusCode: undefined,
      headers: {} as Record<string, string>,
      cookies: {} as Record<string, any>,
      status(code: number) {
        reply.statusCode = code;
        return reply;
      },
      header(name: string, value: string) {
        reply.headers[name] = value;
        return reply;
      },
      setCookie(name: string, value: string, opts: any) {
        reply.cookies[name] = { value, ...opts };
        return reply;
      },
      send: jest.fn().mockReturnValue('sent'),
    };
    return reply;
  }

  beforeAll(async () => {
    db = new Kysely<any>({
      dialect: new PostgresJSDialect({
        postgres: postgres(process.env.SOCIAL_INTEGRATION_DB!),
      }),
      plugins: [new CamelCasePlugin()],
    });
    redis = new Redis(process.env.SOCIAL_INTEGRATION_REDIS!, {
      lazyConnect: true,
    });
    await redis.connect();

    await db
      .deleteFrom('authAccounts')
      .where('workspaceId', 'in', (eb) =>
        eb.selectFrom('workspaces').select('id').where('hostname', '=', HOSTNAME),
      )
      .execute();
    await db
      .deleteFrom('authProviders')
      .where('workspaceId', 'in', (eb) =>
        eb.selectFrom('workspaces').select('id').where('hostname', '=', HOSTNAME),
      )
      .execute();
    await db
      .deleteFrom('workspaces')
      .where('hostname', '=', HOSTNAME)
      .execute();

    const workspace = await db
      .insertInto('workspaces')
      .values({ name: 'Social Test', hostname: HOSTNAME })
      .returningAll()
      .executeTakeFirstOrThrow();
    workspaceId = workspace.id;

    await db
      .insertInto('groups')
      .values({ name: 'Default', isDefault: true, workspaceId })
      .execute();

    audit = { log: jest.fn(), setActorId: jest.fn() };
    auditCalls = [];
    audit.log.mockImplementation((payload: any) => auditCalls.push(payload));

    const environmentService = {
      getAppSecret: () => 'integration-test-secret',
      isHttps: () => true,
      isCloud: () => false,
      getCookieExpiresIn: () => new Date(Date.now() + 86400000),
    };
    const domainService = { getUrl: () => APP_URL };
    const cryptoService = new AppSecretCryptoService(environmentService as any);

    const userRepo = new UserRepo(db as any);
    const groupRepo = new GroupRepo(db as any);
    const groupUserRepo = new GroupUserRepo(
      db as any,
      groupRepo as any,
      userRepo as any,
    );
    const instanceSettingRepo = new InstanceSettingRepo(db as any);

    const workspaceService = {
      addUserToWorkspace: async (userId: string, wsId: string) => {
        await db
          .updateTable('users')
          .set({ role: 'member', workspaceId: wsId })
          .where('id', '=', userId)
          .execute();
      },
    };

    githubProvider = new GithubOauthProvider();
    const googleProvider = new GoogleOidcProvider();

    const tokenService = {
      generateAccessToken: async () => 'integration-auth-token',
      generateMfaToken: async () => 'integration-mfa-token',
    };

    socialService = new SocialAuthService(
      db as any,
      userRepo as any,
      { findByUserId: async () => null } as any,
      instanceSettingRepo as any,
      groupUserRepo as any,
      workspaceService as any,
      tokenService as any,
      { decryptTotpSecret: () => 'x' } as any,
      domainService as any,
      environmentService as any,
      cryptoService as any,
      githubProvider as any,
      googleProvider as any,
      auditService() as any,
      { getOrThrow: () => redis } as any,
    );

    ssoService = new SsoService(
      db as any,
      { findById: async (id: string) => ({ id, hostname: HOSTNAME }) } as any,
      userRepo as any,
      groupRepo as any,
      groupUserRepo as any,
      workspaceService as any,
      tokenService as any,
      environmentService as any,
      domainService as any,
      cryptoService as any,
      { getOrThrow: () => redis } as any,
      auditService() as any,
    );
  });

  afterAll(async () => {
    await redis.quit();
    await db.destroy();
  });

  beforeEach(async () => {
    await db.deleteFrom('authAccounts').execute();
    await db.deleteFrom('authProviders').execute();
    await db.deleteFrom('users').where('workspaceId', '=', workspaceId).execute();
    const keys = await redis.keys('sso:social:state:*');
    if (keys.length) {
      await redis.del(...keys);
    }
    auditCalls.length = 0;
  });

  it('stores the secret encrypted and exposes only a configured flag', async () => {
    const created = await ssoService.createProvider(workspaceId, null as any, {
      type: 'github',
      name: 'GitHub',
      clientId: 'gh-client',
      clientSecret: 'gh-secret-value',
      isEnabled: true,
      allowSignup: true,
    } as any);

    expect(created.hasClientSecret).toBe(true);
    expect(created.callbackUrl).toBe(
      `${APP_URL}/api/auth/social/github/callback`,
    );
    expect(JSON.stringify(created)).not.toContain('gh-secret-value');

    const row = await db
      .selectFrom('authProviders')
      .select(['oidcClientSecret'])
      .where('workspaceId', '=', workspaceId)
      .where('type', '=', 'github')
      .executeTakeFirstOrThrow();
    expect(row.oidcClientSecret.startsWith('wlenc:v1:')).toBe(true);
    expect(row.oidcClientSecret).not.toContain('gh-secret-value');
  });

  it('enforces one provider per workspace type at the database level', async () => {
    await ssoService.createProvider(workspaceId, null as any, {
      type: 'github',
      name: 'GitHub',
    } as any);

    await expect(
      ssoService.createProvider(workspaceId, null as any, {
        type: 'github',
        name: 'GitHub 2',
      } as any),
    ).rejects.toThrow();
  });

  it('runs the full controller callback flow: start, callback, signup, replay rejection', async () => {
    await ssoService.createProvider(workspaceId, null as any, {
      type: 'github',
      name: 'GitHub',
      clientId: 'gh-client',
      clientSecret: 'gh-secret-value',
      isEnabled: true,
      allowSignup: true,
    } as any);
    mockGithubEndpoints({
      githubUserId: 9001,
      email: 'New.User@Example.com',
    });

    const controller = new SocialAuthController(socialService, {
      isRecentlyAuthenticated: () => true,
    } as any);

    // Start: 302 to GitHub with state.
    const startReply = fakeReply();
    await controller.startLogin('github', makeWorkspace(), undefined, startReply);
    expect(startReply.statusCode).toBe(HttpStatus.FOUND);
    const authorizeUrl = new URL(startReply.headers.Location);
    expect(authorizeUrl.origin).toBe('https://github.com');
    const state = authorizeUrl.searchParams.get('state')!;
    expect(state).toBeTruthy();

    // Callback: creates the user, links the identity, sets the session cookie.
    const cbReply = fakeReply();
    await controller.callback(
      'github',
      makeWorkspace(),
      { code: 'code-abc', state },
      cbReply,
    );
    expect(cbReply.statusCode).toBe(HttpStatus.SEE_OTHER);
    expect(cbReply.headers.Location).toBe(`${APP_URL}/home`);
    expect(cbReply.cookies.authToken.value).toBe('integration-auth-token');

    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirstOrThrow();
    expect(user.email).toBe('new.user@example.com');
    expect(user.emailVerifiedAt).toBeTruthy();
    expect(user.hasGeneratedPassword).toBe(true);

    const link = await db
      .selectFrom('authAccounts')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirstOrThrow();
    expect(link.providerUserId).toBe('9001');
    expect(link.userId).toBe(user.id);

    // Audit: login recorded with actor and provider source.
    const loginAudit = auditCalls.find((c) => c.event === 'user.login');
    expect(loginAudit?.metadata).toMatchObject({ source: 'github' });
    expect(audit.setActorId).toHaveBeenCalledWith(user.id);

    // Replay of the same state is rejected and redirects to the login page.
    const replayReply = fakeReply();
    await controller.callback(
      'github',
      makeWorkspace(),
      { code: 'code-abc', state },
      replayReply,
    );
    expect(replayReply.statusCode).toBe(HttpStatus.SEE_OTHER);
    expect(replayReply.headers.Location).toContain(
      '/login?error=state_invalid',
    );
  });

  it('logs into the same account by provider id and blocks email-based takeover', async () => {
    await ssoService.createProvider(workspaceId, null as any, {
      type: 'github',
      name: 'GitHub',
      clientId: 'gh-client',
      clientSecret: 'gh-secret-value',
      isEnabled: true,
      allowSignup: true,
    } as any);
    mockGithubEndpoints({ githubUserId: 9002, email: 'shared@example.com' });

    const state1 = await socialService.startLogin(makeWorkspace(), 'github');
    const s1 = new URL(state1).searchParams.get('state')!;
    await socialService.handleCallback({
      workspace: makeWorkspace(),
      type: 'github',
      query: { code: 'c', state: s1 },
    });

    // A second GitHub identity with the same email must NOT attach to the
    // existing account (no silent email linking).
    mockGithubEndpoints({ githubUserId: 9003, email: 'shared@example.com' });
    const state2 = await socialService.startLogin(makeWorkspace(), 'github');
    const s2 = new URL(state2).searchParams.get('state')!;
    await expect(
      socialService.handleCallback({
        workspace: makeWorkspace(),
        type: 'github',
        query: { code: 'c', state: s2 },
      }),
    ).rejects.toMatchObject({ code: 'account_not_linked' });

    // The original provider identity keeps logging into the same user.
    mockGithubEndpoints({ githubUserId: 9002, email: 'shared@example.com' });
    const state3 = await socialService.startLogin(makeWorkspace(), 'github');
    const s3 = new URL(state3).searchParams.get('state')!;
    const result = await socialService.handleCallback({
      workspace: makeWorkspace(),
      type: 'github',
      query: { code: 'c', state: s3 },
    });
    expect(result.kind).toBe('session');
  });

  it('blocks an in-flight callback when the provider is disabled mid-flow', async () => {
    const provider = await ssoService.createProvider(workspaceId, null as any, {
      type: 'github',
      name: 'GitHub',
      clientId: 'gh-client',
      clientSecret: 'gh-secret-value',
      isEnabled: true,
      allowSignup: true,
    } as any);
    mockGithubEndpoints({ githubUserId: 9004, email: 'mid@example.com' });

    const url = await socialService.startLogin(makeWorkspace(), 'github');
    const state = new URL(url).searchParams.get('state')!;

    await db
      .updateTable('authProviders')
      .set({ isEnabled: false })
      .where('id', '=', provider.providerId)
      .execute();

    await expect(
      socialService.handleCallback({
        workspace: makeWorkspace(),
        type: 'github',
        query: { code: 'c', state },
      }),
    ).rejects.toMatchObject({ code: 'provider_disabled' });
  });

  it('rejects social login when the workspace enforces SAML SSO', async () => {
    await ssoService.createProvider(workspaceId, null as any, {
      type: 'github',
      name: 'GitHub',
      clientId: 'gh-client',
      clientSecret: 'gh-secret-value',
      isEnabled: true,
      allowSignup: true,
    } as any);

    await expect(
      socialService.startLogin(
        makeWorkspace({ enforceSso: true }),
        'github',
      ),
    ).rejects.toMatchObject({ code: 'sso_enforced' });
  });

  it('the unique index prevents concurrent duplicate links', async () => {
    const provider = await ssoService.createProvider(workspaceId, null as any, {
      type: 'github',
      name: 'GitHub',
      clientId: 'gh-client',
      clientSecret: 'gh-secret-value',
      isEnabled: true,
      allowSignup: true,
    } as any);

    const userA = await db
      .insertInto('users')
      .values({
        name: 'A',
        email: 'a-link@example.com',
        password: 'x',
        workspaceId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const userB = await db
      .insertInto('users')
      .values({
        name: 'B',
        email: 'b-link@example.com',
        password: 'x',
        workspaceId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('authAccounts')
      .values({
        userId: userA.id,
        providerUserId: '9005',
        authProviderId: provider.providerId,
        workspaceId,
      })
      .execute();

    await expect(
      db
        .insertInto('authAccounts')
        .values({
          userId: userB.id,
          providerUserId: '9005',
          authProviderId: provider.providerId,
          workspaceId,
        })
        .execute(),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('lists and unlinks connected accounts', async () => {
    await ssoService.createProvider(workspaceId, null as any, {
      type: 'github',
      name: 'GitHub',
      clientId: 'gh-client',
      clientSecret: 'gh-secret-value',
      isEnabled: true,
      allowSignup: true,
    } as any);
    mockGithubEndpoints({ githubUserId: 9006, email: 'unlink@example.com' });

    const url = await socialService.startLogin(makeWorkspace(), 'github');
    const state = new URL(url).searchParams.get('state')!;
    await socialService.handleCallback({
      workspace: makeWorkspace(),
      type: 'github',
      query: { code: 'c', state },
    });

    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirstOrThrow();

    const accounts = await socialService.listAccounts(user as any, makeWorkspace());
    expect(accounts.items).toHaveLength(1);
    expect(accounts.items[0]).toMatchObject({ providerType: 'github' });
    // The provider user id is internal and not exposed to the client.
    expect(JSON.stringify(accounts)).not.toContain('9006');

    await socialService.unlink(user as any, makeWorkspace(), 'github');
    const after = await socialService.listAccounts(user as any, makeWorkspace());
    expect(after.items).toHaveLength(0);
  });
});
