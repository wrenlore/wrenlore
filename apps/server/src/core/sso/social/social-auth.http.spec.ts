import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { JwtService } from '@nestjs/jwt';
import { SocialAuthController } from './social-auth.controller';
import { SocialAuthService } from './social-auth.service';
import { TokenService } from '../../auth/services/token.service';
import { JwtStrategy } from '../../auth/strategies/jwt.strategy';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { UserRepo } from '@wrenlore/db/repos/user/user.repo';
import { WorkspaceRepo } from '@wrenlore/db/repos/workspace/workspace.repo';
import {
  createService,
  makeUser,
  makeWorkspace,
  githubProviderRow,
  userId,
  workspaceId,
} from './social-auth.test-fixture';

describe('Social auth HTTP browser/session boundaries', () => {
  let app: NestFastifyApplication;
  let ctx: ReturnType<typeof createService>;
  let jwt: JwtService;
  let workspace: ReturnType<typeof makeWorkspace>;
  let tokenService: TokenService;

  beforeEach(async () => {
    ctx = createService();
    workspace = makeWorkspace();
    jwt = new JwtService({
      secret: 'social-http-test-only',
      signOptions: { expiresIn: '1h' },
    });
    const environment = {
      ...ctx.environmentService,
      getAppSecret: () => 'social-http-test-only',
    };
    tokenService = new TokenService(jwt, environment as any);
    ctx.tokenService.verifyJwt.mockImplementation((...args: any[]) =>
      tokenService.verifyJwt(args[0], args[1]),
    );
    const module = await Test.createTestingModule({
      controllers: [SocialAuthController],
      providers: [
        JwtStrategy,
        { provide: SocialAuthService, useValue: ctx.service },
        { provide: TokenService, useValue: tokenService },
        { provide: EnvironmentService, useValue: environment },
        { provide: UserRepo, useValue: ctx.userRepo },
        {
          provide: WorkspaceRepo,
          useValue: { findById: async () => workspace },
        },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.register(cookie);
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onRequest', async (req: any) => {
        req.raw.workspace = workspace;
        req.raw.workspaceId = workspace.id;
      });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterEach(async () => {
    await app?.close();
  });

  async function start(type = 'github') {
    ctx.db.queueSelect('authProviders', githubProviderRow({ type }));
    const res = await app.inject({
      method: 'GET',
      url: `/auth/social/${type}/start`,
    });
    expect(res.statusCode).toBe(302);
    const state = new URL(res.headers.location as string).searchParams.get(
      'state',
    )!;
    const flowCookie = res.cookies.find((c) => c.name.includes('wl-social-'))!;
    expect(flowCookie.httpOnly).toBe(true);
    expect(flowCookie.secure).toBe(true);
    expect(flowCookie.sameSite).toBe('Lax');
    expect(flowCookie.path).toBe('/');
    expect(flowCookie.domain).toBeUndefined();
    expect(flowCookie.maxAge).toBe(600);
    return {
      state,
      flowCookie,
      cookies: { [flowCookie.name]: flowCookie.value },
    };
  }
  function ready(type = 'github') {
    ctx.db.queueSelect('authProviders', githubProviderRow({ type }));
    ctx.db.queueSelect('authAccounts', { userId, providerUserId: 'gh-123' });
  }
  function callback(state: string, cookies = {}, type = 'github') {
    return app.inject({
      method: 'GET',
      url: `/auth/social/${type}/callback?code=provider-code&state=${state}`,
      cookies,
    });
  }

  it.each(['github', 'google'])(
    'rejects a %s callback from a different browser',
    async (type) => {
      const flow = await start(type);
      const res = await callback(flow.state, {}, type);
      expect(res.headers.location).toContain('error=state_invalid');
      expect(res.cookies.some((c) => c.name === 'authToken')).toBe(false);
      expect(ctx.githubDriver.resolveIdentity).not.toHaveBeenCalled();
      expect(ctx.googleDriver.resolveIdentity).not.toHaveBeenCalled();
    },
  );

  it.each(['github', 'google'])(
    'accepts the initiating %s browser once and clears its cookie',
    async (type) => {
      const flow = await start(type);
      ready(type);
      const res = await callback(flow.state, flow.cookies, type);
      expect(res.headers.location).toBe('https://tenant.example.com/home');
      expect(res.cookies.some((c) => c.name === 'authToken')).toBe(true);
      expect(
        res.cookies
          .find((c) => c.name === flow.flowCookie.name)
          ?.expires?.getTime(),
      ).toBe(0);
      const replay = await callback(flow.state, flow.cookies, type);
      expect(replay.headers.location).toContain('error=state_invalid');
    },
  );

  it('uses separate cookies for parallel attempts and rejects swapped bindings', async () => {
    const a = await start();
    const b = await start();
    expect(a.flowCookie.name).not.toBe(b.flowCookie.name);
    const res = await callback(a.state, {
      [a.flowCookie.name]: b.flowCookie.value,
    });
    expect(res.headers.location).toContain('error=state_invalid');
    ready();
    expect((await callback(b.state, b.cookies)).headers.location).toContain(
      '/home',
    );
  });

  async function startLink(authToken: string) {
    ctx.db.queueSelect('authProviders', githubProviderRow());
    return app.inject({
      method: 'POST',
      url: '/auth/social/link/start',
      cookies: { authToken },
      payload: { providerType: 'github' },
    });
  }
  it('requires authentication and recent sign-in to initiate a link', async () => {
    const anon = await app.inject({
      method: 'POST',
      url: '/auth/social/link/start',
      payload: { providerType: 'github' },
    });
    expect(anon.statusCode).toBe(401);
    const old = jwt.sign({
      sub: userId,
      workspaceId,
      type: 'access',
      iat: Math.floor(Date.now() / 1000) - 900,
    });
    expect((await startLink(old)).statusCode).toBe(403);
  });

  it.each(['absent', 'changed', 'expired', 'wrong-user', 'wrong-workspace'])(
    'rejects linking when callback session is %s',
    async (scenario) => {
      const original = await tokenService.generateAccessToken(makeUser());
      const res = await startLink(original);
      expect(res.statusCode).toBe(200);
      const state = new URL(res.json().url).searchParams.get('state')!;
      const flowCookie = res.cookies.find((c) =>
        c.name.includes('wl-social-'),
      )!;
      ready();
      const cookies: Record<string, string> = {
        [flowCookie.name]: flowCookie.value,
      };
      if (scenario !== 'absent') cookies.authToken = original;
      if (scenario === 'changed')
        cookies.authToken = jwt.sign({
          sub: userId,
          workspaceId,
          type: 'access',
          jti: 'new-session',
        });
      if (scenario === 'expired')
        ctx.tokenService.verifyJwt.mockRejectedValueOnce(new Error('expired'));
      if (scenario === 'wrong-user')
        ctx.tokenService.verifyJwt.mockResolvedValueOnce({
          sub: 'other',
          workspaceId,
        });
      if (scenario === 'wrong-workspace')
        ctx.tokenService.verifyJwt.mockResolvedValueOnce({
          sub: userId,
          workspaceId: 'other',
        });
      const cb = await callback(state, cookies);
      expect(cb.headers.location).toContain('error=state_invalid');
      expect(ctx.githubDriver.resolveIdentity).not.toHaveBeenCalled();
    },
  );

  it('links for the same authenticated session, but rejects SAML enforcement at start and callback', async () => {
    const authToken = await tokenService.generateAccessToken(makeUser());
    const res = await startLink(authToken);
    expect(res.statusCode).toBe(200);
    const flowCookie = res.cookies.find((c) => c.name.includes('wl-social-'))!;
    const state = new URL(res.json().url).searchParams.get('state')!;
    ctx.db.queueSelect('authProviders', githubProviderRow());
    ctx.db.queueSelect('authAccounts', null);
    const cb = await callback(state, {
      [flowCookie.name]: flowCookie.value,
      authToken,
    });
    expect(cb.headers.location).toContain('social=connected');

    const pending = await startLink(authToken);
    workspace.enforceSso = true;
    const next = await startLink(authToken);
    expect(next.statusCode).toBe(400);
    const pendingCookie = pending.cookies.find((c) =>
      c.name.includes('wl-social-'),
    )!;
    const pendingState = new URL(pending.json().url).searchParams.get('state')!;
    const blocked = await callback(pendingState, {
      [pendingCookie.name]: pendingCookie.value,
      authToken,
    });
    expect(blocked.headers.location).toContain('error=sso_enforced');
  });
});
