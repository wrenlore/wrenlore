import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@wrenlore/db/types/kysely.types';
import { executeTx } from '@wrenlore/db/utils';
import { UserRepo } from '@wrenlore/db/repos/user/user.repo';
import { GroupUserRepo } from '@wrenlore/db/repos/group/group-user.repo';
import { WorkspaceService } from '../../workspace/services/workspace.service';
import { AuthService } from '../../auth/services/auth.service';
import { JwtType } from '../../auth/dto/jwt-payload';
import { TokenService } from '../../auth/services/token.service';
import { validateAllowedEmail } from '../../auth/auth.util';
import { DomainService } from '../../../integrations/environment/domain.service';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { AppSecretCryptoService } from '../../../common/crypto/app-secret-crypto.service';
import { AuditEvent, AuditResource } from '../../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../../integrations/audit/audit.service';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import { AuthProvider, User, Workspace } from '@wrenlore/db/types/entity.types';
import { isUserDisabled, nanoIdGen } from '../../../common/helpers';
import {
  SOCIAL_STATE_KEY_PREFIX,
  SOCIAL_STATE_TTL_MS,
  SocialIdentity,
  SocialProviderDriver,
  SocialProviderType,
} from './social.constants';
import { GithubOauthProvider } from './providers/github-oauth.provider';
import { GoogleOidcProvider } from './providers/google-oidc.provider';

export class SocialAuthFlowError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

interface StoredSocialState {
  workspaceId: string;
  providerId: string;
  providerType: SocialProviderType;
  operation: 'login' | 'link';
  userId?: string;
  redirect?: string;
  codeVerifier?: string;
  nonce?: string;
  createdAt: number;
  browserBindingHash: string;
  sessionTokenHash?: string;
}

export type SocialCallbackResult =
  | {
      kind: 'session';
      authToken: string;
      requiresMfaSetup: boolean;
      redirectUrl: string;
    }
  | { kind: 'mfa'; mfaToken: string; redirectUrl: string }
  | { kind: 'linked'; redirectUrl: string };

@Injectable()
export class SocialAuthService {
  private readonly logger = new Logger(SocialAuthService.name);
  private readonly redis: Redis;
  private readonly drivers: Record<SocialProviderType, SocialProviderDriver>;

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly userRepo: UserRepo,
    private readonly groupUserRepo: GroupUserRepo,
    private readonly workspaceService: WorkspaceService,
    private readonly tokenService: TokenService,
    private readonly authService: AuthService,
    private readonly domainService: DomainService,
    private readonly environmentService: EnvironmentService,
    private readonly cryptoService: AppSecretCryptoService,
    private readonly githubDriver: GithubOauthProvider,
    private readonly googleDriver: GoogleOidcProvider,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
    redisService: RedisService,
  ) {
    this.redis = redisService.getOrThrow();
    this.drivers = {
      github: githubDriver,
      google: googleDriver,
    };
  }

  getCallbackUrl(workspace: Workspace, type: SocialProviderType): string {
    return `${this.domainService.getUrl(workspace.hostname)}/api/auth/social/${type}/callback`;
  }

  getLoginErrorUrl(workspace: Workspace, code: string): string {
    const baseUrl = this.domainService.getUrl(workspace.hostname);
    return `${baseUrl}/login?error=${encodeURIComponent(code)}`;
  }

  setAuthCookie(res: FastifyReply, token: string) {
    res.setCookie('authToken', token, {
      httpOnly: true,
      path: '/',
      expires: this.environmentService.getCookieExpiresIn(),
      secure: this.environmentService.isHttps(),
    });
  }

  browserCookieName(state: unknown): string | null {
    if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state))
      return null;
    const prefix = this.environmentService.isHttps() ? '__Host-' : '';
    return `${prefix}wl-social-${state}`;
  }

  setBrowserCookie(res: FastifyReply, authorizeUrl: string, binding: string) {
    const name = this.browserCookieName(
      new URL(authorizeUrl).searchParams.get('state'),
    );
    if (!name) throw new SocialAuthFlowError('state_invalid');
    res.setCookie(name, binding, {
      httpOnly: true,
      secure: this.environmentService.isHttps(),
      sameSite: 'lax',
      path: '/',
      maxAge: SOCIAL_STATE_TTL_MS / 1000,
    });
  }

  clearBrowserCookie(res: FastifyReply, state: unknown) {
    const name = this.browserCookieName(state);
    if (name)
      res.clearCookie(name, {
        httpOnly: true,
        secure: this.environmentService.isHttps(),
        sameSite: 'lax',
        path: '/',
      });
  }

  async startLogin(
    workspace: Workspace,
    type: SocialProviderType,
    browserBinding: string,
    redirect?: string,
  ): Promise<string> {
    if (workspace.enforceSso) {
      throw new SocialAuthFlowError('sso_enforced');
    }

    const provider = await this.getConfiguredProvider(workspace.id, type);
    const state = this.newState();

    return this.beginFlow({
      workspace,
      provider,
      type,
      operation: 'login',
      browserBinding,
      state,
      redirect,
    });
  }

  async startLink(
    user: User,
    workspace: Workspace,
    type: SocialProviderType,
    browserBinding: string,
    sessionToken: string,
    redirect?: string,
  ): Promise<string> {
    if (workspace.enforceSso) throw new SocialAuthFlowError('sso_enforced');
    if (isUserDisabled(user) || user.workspaceId !== workspace.id) {
      throw new UnauthorizedException('User account is disabled.');
    }

    const provider = await this.getConfiguredProvider(workspace.id, type);
    const state = this.newState();

    return this.beginFlow({
      workspace,
      provider,
      type,
      operation: 'link',
      browserBinding,
      sessionToken,
      userId: user.id,
      state,
      redirect,
    });
  }

  async handleCallback(opts: {
    workspace: Workspace;
    type: SocialProviderType;
    query: Record<string, string | undefined>;
    browserBinding?: string;
    sessionToken?: string;
  }): Promise<SocialCallbackResult> {
    const { workspace, type, query } = opts;

    const stateValue = query.state;
    const code = query.code;
    if (query.error || !stateValue || !code) {
      this.logLoginFailure(workspace, type, 'provider_rejected');
      throw new SocialAuthFlowError('provider_rejected');
    }

    if (!this.browserCookieName(stateValue))
      throw new SocialAuthFlowError('state_invalid');
    const stored = await this.consumeState(stateValue);
    if (
      !stored ||
      stored.providerType !== type ||
      stored.workspaceId !== workspace.id ||
      !this.matchesBinding(stored.browserBindingHash, opts.browserBinding)
    ) {
      this.logLoginFailure(workspace, type, 'state_invalid');
      throw new SocialAuthFlowError('state_invalid');
    }

    // Re-load the provider so disabling it blocks in-flight callbacks.
    const provider = await this.findProviderRow(stored.providerId);
    if (
      !provider ||
      provider.workspaceId !== workspace.id ||
      provider.type !== type ||
      !provider.isEnabled ||
      !provider.oidcClientId ||
      !provider.oidcClientSecret
    ) {
      this.logLoginFailure(workspace, type, 'provider_disabled');
      throw new SocialAuthFlowError('provider_disabled');
    }

    if (workspace.enforceSso) {
      this.logLoginFailure(workspace, type, 'sso_enforced');
      throw new SocialAuthFlowError('sso_enforced');
    }

    if (stored.operation === 'link') {
      if (!this.matchesBinding(stored.sessionTokenHash, opts.sessionToken)) {
        throw new SocialAuthFlowError('state_invalid');
      }
      try {
        const payload = await this.tokenService.verifyJwt(
          opts.sessionToken,
          JwtType.ACCESS,
        );
        if (
          payload.sub !== stored.userId ||
          payload.workspaceId !== workspace.id
        ) {
          throw new Error('Session changed');
        }
      } catch {
        throw new SocialAuthFlowError('state_invalid');
      }
    }

    const clientSecret = this.decryptSecret(provider.oidcClientSecret);
    const redirectUri = this.getCallbackUrl(workspace, type);

    let identity: SocialIdentity;
    try {
      identity = await this.drivers[type].resolveIdentity({
        clientId: provider.oidcClientId,
        clientSecret,
        redirectUri,
        code,
        state: stateValue,
        codeVerifier: stored.codeVerifier,
        nonce: stored.nonce,
      });
    } catch (error) {
      this.logger.warn(`Social identity resolution failed (${type})`);
      this.logLoginFailure(workspace, type, 'identity_failed');
      throw new SocialAuthFlowError('identity_failed');
    }

    if (stored.operation === 'link') {
      return this.completeLink({
        workspace,
        provider,
        type,
        stored,
        identity,
      });
    }

    return this.completeLogin({ workspace, provider, type, stored, identity });
  }

  async listAccounts(user: User, workspace: Workspace) {
    const rows = await this.db
      .selectFrom('authAccounts')
      .innerJoin(
        'authProviders',
        'authProviders.id',
        'authAccounts.authProviderId',
      )
      .select([
        'authAccounts.id',
        'authAccounts.providerUserId',
        'authAccounts.createdAt',
        'authProviders.type',
        'authProviders.name',
      ])
      .where('authAccounts.workspaceId', '=', workspace.id)
      .where('authAccounts.userId', '=', user.id)
      .where('authAccounts.deletedAt', 'is', null)
      .where('authProviders.deletedAt', 'is', null)
      .where('authProviders.type', 'in', ['github', 'google'])
      .orderBy('authAccounts.createdAt', 'asc')
      .execute();

    return {
      linkingAllowed: !workspace.enforceSso,
      items: rows.map((row) => ({
        id: row.id,
        providerType: row.type as SocialProviderType,
        providerName: row.name,
        connectedAt: row.createdAt,
      })),
    };
  }

  async unlink(
    user: User,
    workspace: Workspace,
    type: SocialProviderType,
  ): Promise<void> {
    const provider = await this.findProviderRowByWorkspace(workspace.id, type);
    if (!provider) {
      throw new NotFoundException('Provider not found');
    }

    const deleted = await this.db
      .updateTable('authAccounts')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('workspaceId', '=', workspace.id)
      .where('userId', '=', user.id)
      .where('authProviderId', '=', provider.id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!deleted || Number(deleted.numUpdatedRows) === 0) {
      throw new NotFoundException('This account is not connected.');
    }

    this.auditService.setActorId(user.id);
    this.auditService.log({
      event: AuditEvent.USER_AUTH_ACCOUNT_UNLINKED,
      resourceType: AuditResource.USER,
      resourceId: user.id,
      metadata: { workspaceId: workspace.id, providerType: type },
    });
  }

  private async beginFlow(opts: {
    workspace: Workspace;
    provider: AuthProvider;
    type: SocialProviderType;
    operation: 'login' | 'link';
    userId?: string;
    state: string;
    browserBinding: string;
    sessionToken?: string;
    redirect?: string;
  }): Promise<string> {
    const { workspace, provider, type, operation, userId, state, redirect } =
      opts;

    const driver = this.drivers[type];
    const codeVerifier = randomBytes(32).toString('base64url');
    const nonce =
      type === 'google' ? GoogleOidcProvider.generateNonce() : undefined;

    const record: StoredSocialState = {
      workspaceId: workspace.id,
      providerId: provider.id,
      providerType: type,
      operation,
      userId,
      redirect: this.safeRedirectPath(redirect, workspace),
      codeVerifier,
      nonce,
      createdAt: Date.now(),
      browserBindingHash: this.hashBinding(opts.browserBinding),
      sessionTokenHash: opts.sessionToken
        ? this.hashBinding(opts.sessionToken)
        : undefined,
    };

    const key = `${SOCIAL_STATE_KEY_PREFIX}${state}`;
    const saved = await this.redis.set(
      key,
      JSON.stringify(record),
      'PX',
      SOCIAL_STATE_TTL_MS,
      'NX',
    );
    if (saved !== 'OK') {
      throw new SocialAuthFlowError('state_invalid');
    }

    const { authorizeUrl } = await driver.buildAuthorizeUrl({
      clientId: provider.oidcClientId as string,
      clientSecret: this.decryptSecret(provider.oidcClientSecret),
      redirectUri: this.getCallbackUrl(workspace, type),
      state,
      codeVerifier,
      nonce,
    });

    return authorizeUrl;
  }

  private async completeLogin(opts: {
    workspace: Workspace;
    provider: AuthProvider;
    type: SocialProviderType;
    stored: StoredSocialState;
    identity: SocialIdentity;
  }): Promise<SocialCallbackResult> {
    const { workspace, provider, type, stored, identity } = opts;
    const baseUrl = this.domainService.getUrl(workspace.hostname);

    const user = await executeTx(this.db, async (trx) => {
      const existingLink = await trx
        .selectFrom('authAccounts')
        .selectAll()
        .where('workspaceId', '=', workspace.id)
        .where('authProviderId', '=', provider.id)
        .where('providerUserId', '=', identity.providerUserId)
        .where('deletedAt', 'is', null)
        .executeTakeFirst();

      let resolvedUser: User | undefined;

      if (existingLink) {
        resolvedUser = await this.userRepo.findById(
          existingLink.userId,
          workspace.id,
          {
            trx,
          },
        );
        if (!resolvedUser || isUserDisabled(resolvedUser)) {
          throw new SocialAuthFlowError('account_disabled');
        }
      } else {
        // No silent email-match linking: an existing local account is never
        // attached to a provider identity from the login callback. The same
        // message is used whether or not an account exists so the response
        // does not disclose account existence.
        const emailMatch = identity.email
          ? await this.userRepo.findByEmail(identity.email, workspace.id, {
              trx,
            })
          : null;

        if (emailMatch) {
          throw new SocialAuthFlowError('account_not_linked');
        }

        if (!provider.allowSignup) {
          throw new SocialAuthFlowError('signup_not_allowed');
        }

        if (!identity.email || !identity.emailVerified) {
          throw new SocialAuthFlowError('email_unverified');
        }

        try {
          validateAllowedEmail(identity.email, workspace);
        } catch {
          throw new SocialAuthFlowError('domain_not_allowed');
        }

        // In cloud mode new accounts may only be created through workspace
        // invitations; a pending invitation for this email is required.
        if (this.environmentService.isCloud()) {
          const invited = await trx
            .selectFrom('workspaceInvitations')
            .select('id')
            .where('workspaceId', '=', workspace.id)
            .where('email', '=', identity.email)
            .executeTakeFirst();
          if (!invited) {
            throw new SocialAuthFlowError('signup_not_allowed');
          }
        }

        resolvedUser = await this.userRepo.insertUser(
          {
            name: identity.displayName ?? identity.email.split('@')[0],
            email: identity.email,
            password: nanoIdGen(32),
            workspaceId: workspace.id,
            emailVerifiedAt: new Date(),
            hasGeneratedPassword: true,
          },
          trx,
        );

        await this.workspaceService.addUserToWorkspace(
          resolvedUser.id,
          workspace.id,
          undefined,
          trx,
        );
        await this.groupUserRepo.addUserToDefaultGroup(
          resolvedUser.id,
          workspace.id,
          trx,
        );

        this.auditService.log({
          event: AuditEvent.USER_CREATED,
          resourceType: AuditResource.USER,
          resourceId: resolvedUser.id,
          changes: {
            after: { name: resolvedUser.name, email: resolvedUser.email },
          },
          metadata: { workspaceId: workspace.id, source: type },
        });
      }

      if (!existingLink) {
        const inserted = await trx
          .insertInto('authAccounts')
          .values({
            userId: resolvedUser.id,
            providerUserId: identity.providerUserId,
            authProviderId: provider.id,
            workspaceId: workspace.id,
          })
          .onConflict((oc) => oc.doNothing())
          .returning('id')
          .executeTakeFirst();

        if (!inserted) {
          // Unique index (workspace, provider, providerUserId) hit: the
          // identity raced into another account. Never re-point it silently.
          throw new SocialAuthFlowError('link_collision');
        }
      }

      if (
        !resolvedUser.emailVerifiedAt &&
        identity.emailVerified &&
        identity.email &&
        identity.email.trim().toLowerCase() ===
          resolvedUser.email.trim().toLowerCase()
      ) {
        await this.userRepo.updateUser(
          { emailVerifiedAt: new Date() },
          resolvedUser.id,
          workspace.id,
          trx,
        );
        resolvedUser.emailVerifiedAt = new Date();
      }

      return resolvedUser;
    });

    const target = stored.redirect
      ? `${baseUrl}${stored.redirect}`
      : `${baseUrl}/home`;

    const result = await this.authService.loginAuthenticatedUser(
      user,
      workspace.id,
      {
        source: type,
        providerId: provider.id,
      },
    );
    if (typeof result !== 'string' && 'mfaToken' in result) {
      return {
        kind: 'mfa',
        mfaToken: result.mfaToken,
        redirectUrl: `${baseUrl}/login/mfa#mfa_token=${encodeURIComponent(result.mfaToken)}`,
      };
    }
    const requiresMfaSetup = typeof result !== 'string';
    return {
      kind: 'session',
      authToken: typeof result === 'string' ? result : result.authToken,
      requiresMfaSetup,
      redirectUrl: requiresMfaSetup ? `${baseUrl}/login/mfa/setup` : target,
    };
  }

  private async completeLink(opts: {
    workspace: Workspace;
    provider: AuthProvider;
    type: SocialProviderType;
    stored: StoredSocialState;
    identity: SocialIdentity;
  }): Promise<SocialCallbackResult> {
    const { workspace, provider, type, stored, identity } = opts;
    const baseUrl = this.domainService.getUrl(workspace.hostname);

    if (!stored.userId) {
      throw new SocialAuthFlowError('state_invalid');
    }

    const user = await this.userRepo.findById(stored.userId, workspace.id);
    if (!user || isUserDisabled(user)) {
      throw new SocialAuthFlowError('account_disabled');
    }

    try {
      await executeTx(this.db, async (trx) => {
        const existing = await trx
          .selectFrom('authAccounts')
          .select(['id', 'userId'])
          .where('workspaceId', '=', workspace.id)
          .where('authProviderId', '=', provider.id)
          .where('providerUserId', '=', identity.providerUserId)
          .where('deletedAt', 'is', null)
          .executeTakeFirst();

        if (existing) {
          if (existing.userId === user.id) {
            return;
          }
          throw new SocialAuthFlowError('link_collision');
        }

        const inserted = await trx
          .insertInto('authAccounts')
          .values({
            userId: user.id,
            providerUserId: identity.providerUserId,
            authProviderId: provider.id,
            workspaceId: workspace.id,
          })
          .onConflict((oc) =>
            oc
              .columns(['userId', 'authProviderId'])
              .doUpdateSet({
                providerUserId: identity.providerUserId,
                deletedAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .where('authAccounts.workspaceId', '=', workspace.id)
              .where('authAccounts.deletedAt', 'is not', null),
          )
          .returning('id')
          .executeTakeFirst();

        if (!inserted) {
          throw new SocialAuthFlowError('link_collision');
        }
      });
    } catch (error) {
      // A concurrent link may claim the provider identity first.
      if ((error as { code?: string }).code === '23505') {
        throw new SocialAuthFlowError('link_collision');
      }
      throw error;
    }

    this.auditService.setActorId(user.id);
    this.auditService.log({
      event: AuditEvent.USER_AUTH_ACCOUNT_LINKED,
      resourceType: AuditResource.USER,
      resourceId: user.id,
      metadata: { workspaceId: workspace.id, providerType: type },
    });

    return {
      kind: 'linked',
      redirectUrl: `${baseUrl}/settings/account?social=connected`,
    };
  }

  private async getConfiguredProvider(
    workspaceId: string,
    type: SocialProviderType,
  ): Promise<AuthProvider> {
    const provider = await this.findProviderRowByWorkspace(workspaceId, type);
    if (!provider || !provider.isEnabled) {
      throw new SocialAuthFlowError('provider_disabled');
    }
    if (!provider.oidcClientId || !provider.oidcClientSecret) {
      throw new SocialAuthFlowError('provider_not_configured');
    }
    return provider;
  }

  private async findProviderRow(
    providerId: string,
  ): Promise<AuthProvider | null> {
    return this.db
      .selectFrom('authProviders')
      .selectAll()
      .where('id', '=', providerId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  private async findProviderRowByWorkspace(
    workspaceId: string,
    type: SocialProviderType,
  ): Promise<AuthProvider | null> {
    return this.db
      .selectFrom('authProviders')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('type', '=', type)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  private decryptSecret(stored: string): string {
    try {
      return this.cryptoService.decrypt(stored);
    } catch {
      throw new SocialAuthFlowError('provider_not_configured');
    }
  }

  /**
   * Atomically consume a single-use state value (GETDEL). Replay attempts
   * find nothing because the first read deletes the record.
   */
  private async consumeState(state: string): Promise<StoredSocialState | null> {
    const key = `${SOCIAL_STATE_KEY_PREFIX}${state}`;
    const raw = await this.redis.getdel(key);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as StoredSocialState;
      if (
        typeof parsed.workspaceId !== 'string' ||
        typeof parsed.providerId !== 'string' ||
        (parsed.operation !== 'login' && parsed.operation !== 'link')
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private newState(): string {
    // 32 bytes of entropy, URL-safe.
    return randomBytes(32).toString('base64url');
  }

  private safeRedirectPath(
    target: unknown,
    workspace: Workspace,
  ): string | null {
    if (typeof target !== 'string' || target.trim().length === 0) {
      return null;
    }
    const baseUrl = this.domainService.getUrl(workspace.hostname);
    try {
      const resolved = new URL(target, baseUrl);
      if (resolved.origin !== new URL(baseUrl).origin) {
        return null;
      }
      const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
      if (path.startsWith('//') || !path.startsWith('/')) {
        return null;
      }
      return path;
    } catch {
      return null;
    }
  }

  private hashBinding(value: string): string {
    if (!value) throw new SocialAuthFlowError('state_invalid');
    return createHash('sha256').update(value).digest('hex');
  }

  private matchesBinding(
    expected: string | undefined,
    actual: string | undefined,
  ): boolean {
    if (!expected || !actual) return false;
    const supplied = Buffer.from(this.hashBinding(actual), 'hex');
    const stored = Buffer.from(expected, 'hex');
    return (
      stored.length === supplied.length && timingSafeEqual(stored, supplied)
    );
  }

  private logLoginFailure(
    workspace: Workspace,
    type: SocialProviderType,
    code: string,
  ) {
    this.auditService.log({
      event: AuditEvent.USER_LOGIN_FAILED,
      resourceType: AuditResource.WORKSPACE,
      resourceId: workspace.id,
      metadata: {
        workspaceId: workspace.id,
        source: type,
        reason: code,
      },
    });
  }
}
