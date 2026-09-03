import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@wrenlore/db/types/kysely.types';
import { WorkspaceRepo } from '@wrenlore/db/repos/workspace/workspace.repo';
import { UserRepo } from '@wrenlore/db/repos/user/user.repo';
import { GroupRepo } from '@wrenlore/db/repos/group/group.repo';
import { GroupUserRepo } from '@wrenlore/db/repos/group/group-user.repo';
import { WorkspaceService } from '../workspace/services/workspace.service';
import { TokenService } from '../auth/services/token.service';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { DomainService } from '../../integrations/environment/domain.service';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { CreateSsoProviderDto } from './dto/create-sso-provider.dto';
import { UpdateSsoProviderDto } from './dto/update-sso-provider.dto';
import { ProviderIdDto } from './dto/provider-id.dto';
import {
  buildSamlCallbackUrl,
  buildSamlAuthnContextOptions,
  buildSamlEntityId,
  buildRequestPublicUrl,
  buildSamlMetadata,
  canonicalizeSamlAcsUrl,
  getSamlAcsPath,
  normalizeSamlAcsUrl,
  normalizeSamlCertificate,
  SAML_DEFAULT_NAME_ID_FORMAT,
  SAML_HTTP_POST_BINDING,
  SAML_PROVIDER_TYPE,
} from './sso.utils';
import { AuthProvider, User, Workspace } from '@wrenlore/db/types/entity.types';
import { executeTx } from '@wrenlore/db/utils';
import * as passport from 'passport';
import { MultiSamlStrategy } from '@node-saml/passport-saml';
import { isUserDisabled, nanoIdGen } from '../../common/helpers';
import { FastifyReply } from 'fastify';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import type { Redis } from 'ioredis';

type SamlCacheEntry = {
  value: string;
  createdAt: number;
};

type SamlCacheProvider = {
  saveAsync(key: string, value: string): Promise<SamlCacheEntry | null>;
  getAsync(key: string): Promise<string | null>;
  removeAsync(key: string | null): Promise<string | null>;
};

const SAML_REQUEST_ID_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class SsoService implements OnModuleInit {
  private readonly logger = new Logger(SsoService.name);
  private readonly samlCaches = new Map<string, SamlCacheProvider>();
  private readonly redis: Redis;

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly userRepo: UserRepo,
    private readonly groupRepo: GroupRepo,
    private readonly groupUserRepo: GroupUserRepo,
    private readonly workspaceService: WorkspaceService,
    private readonly tokenService: TokenService,
    private readonly environmentService: EnvironmentService,
    private readonly domainService: DomainService,
    private readonly redisService: RedisService,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {
    this.redis = this.redisService.getOrThrow();
  }

  onModuleInit() {
    const strategy = new MultiSamlStrategy(
      {
        passReqToCallback: true,
        validateInResponseTo: 'ifPresent',
        requestIdExpirationPeriodMs: SAML_REQUEST_ID_TTL_MS,
        getSamlOptions: async (req: any, done: any) => {
          try {
            const options = await this.buildSamlOptions(req);
            done(null, options);
          } catch (error) {
            done(error);
          }
        },
      } as any,
      async (req: any, profile: any, done: any) => {
        try {
          const user = await this.resolveSamlLogin(req, profile);
          done(null, user);
        } catch (error) {
          done(error);
        }
      },
      async (req: any, profile: any, done: any) => {
        done(null, profile);
      },
    );

    passport.use('saml', strategy as any);
  }

  async listProviders(workspaceId: string) {
    const items = await this.db
      .selectFrom('authProviders')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .execute();

    return {
      items: items.map((item) => this.serializeProvider(item)),
      meta: {
        limit: items.length,
        hasNextPage: false,
        hasPrevPage: false,
        nextCursor: null,
        prevCursor: null,
      },
    };
  }

  async getProvider(workspaceId: string, dto: ProviderIdDto) {
    const provider = await this.findProviderById(workspaceId, dto.providerId);
    if (!provider) {
      throw new NotFoundException('SSO provider not found');
    }

    return this.serializeProvider(provider);
  }

  async createProvider(
    workspaceId: string,
    creatorId: string,
    dto: CreateSsoProviderDto,
  ) {
    if (dto.type !== SAML_PROVIDER_TYPE) {
      throw new BadRequestException('Only SAML providers are supported.');
    }

    const provider = await this.db
      .insertInto('authProviders')
      .values({
        name: dto.name,
        type: dto.type,
        isEnabled: dto.isEnabled ?? false,
        allowSignup: dto.allowSignup ?? false,
        groupSync: dto.groupSync ?? false,
        creatorId,
        workspaceId,
        requestedAuthnContextMode: 'omit',
      })
      .returningAll()
      .executeTakeFirst();

    this.auditService.log({
      event: AuditEvent.SSO_PROVIDER_CREATED,
      resourceType: AuditResource.SSO_PROVIDER,
      resourceId: provider.id,
      changes: {
        after: {
          name: provider.name,
          type: provider.type,
        },
      },
      metadata: {
        workspaceId,
      },
    });

    return this.serializeProvider(provider);
  }

  async updateProvider(workspaceId: string, dto: UpdateSsoProviderDto) {
    const provider = await this.findProviderById(workspaceId, dto.providerId);
    if (!provider) {
      throw new NotFoundException('SSO provider not found');
    }

    const nextName = typeof dto.name !== 'undefined' ? dto.name : provider.name;
    const nextSamlUrl =
      typeof dto.samlUrl !== 'undefined' ? dto.samlUrl : provider.samlUrl;
    const nextSamlCertificate =
      typeof dto.samlCertificate !== 'undefined'
        ? dto.samlCertificate
          ? normalizeSamlCertificate(dto.samlCertificate)
          : null
        : provider.samlCertificate;
    const nextIsEnabled =
      typeof dto.isEnabled !== 'undefined' ? dto.isEnabled : provider.isEnabled;
    const nextRequestedAuthnContextMode =
      dto.requestedAuthnContextMode ?? provider.requestedAuthnContextMode;
    const nextRequestedAuthnContextClassRefs =
      dto.requestedAuthnContextClassRefs ??
      this.getSamlAuthnContextClassRefs(provider);

    let nextSpAcsUrl = provider.spAcsUrl;
    if (typeof dto.spAcsUrl !== 'undefined') {
      try {
        nextSpAcsUrl = dto.spAcsUrl ? normalizeSamlAcsUrl(dto.spAcsUrl) : null;
      } catch (error) {
        throw new BadRequestException((error as Error).message);
      }
    }

    if (nextIsEnabled && (!nextSamlUrl || !nextSamlCertificate)) {
      throw new BadRequestException(
        'SAML URL and certificate are required before enabling the provider.',
      );
    }

    if (
      nextRequestedAuthnContextMode === 'explicit' &&
      nextRequestedAuthnContextClassRefs.length === 0
    ) {
      throw new BadRequestException(
        'At least one AuthnContext class reference is required in explicit mode.',
      );
    }

    const updateData: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (typeof dto.name !== 'undefined') {
      updateData.name = nextName;
    }

    if (typeof dto.samlUrl !== 'undefined') {
      updateData.samlUrl = nextSamlUrl;
    }

    if (typeof dto.samlCertificate !== 'undefined') {
      updateData.samlCertificate = nextSamlCertificate;
    }

    if (typeof dto.spEntityId !== 'undefined') {
      updateData.spEntityId = dto.spEntityId || null;
    }

    if (typeof dto.spAcsUrl !== 'undefined') {
      updateData.spAcsUrl = nextSpAcsUrl;
      updateData.spAcsUrlKey = nextSpAcsUrl
        ? canonicalizeSamlAcsUrl(nextSpAcsUrl)
        : null;
      updateData.spAcsPath = nextSpAcsUrl ? getSamlAcsPath(nextSpAcsUrl) : null;
    }

    if (typeof dto.spAcsBinding !== 'undefined') {
      updateData.spAcsBinding = dto.spAcsBinding || null;
    }

    if (typeof dto.spSloUrl !== 'undefined') {
      updateData.spSloUrl = dto.spSloUrl || null;
    }

    if (typeof dto.nameIdFormat !== 'undefined') {
      updateData.nameIdFormat = dto.nameIdFormat || null;
    }

    if (typeof dto.idpEntityId !== 'undefined') {
      updateData.idpEntityId = dto.idpEntityId || null;
    }

    if (typeof dto.idpSloUrl !== 'undefined') {
      updateData.idpSloUrl = dto.idpSloUrl || null;
    }

    if (typeof dto.requestedAuthnContextMode !== 'undefined') {
      updateData.requestedAuthnContextMode = dto.requestedAuthnContextMode;
    }

    if (typeof dto.requestedAuthnContextClassRefs !== 'undefined') {
      updateData.requestedAuthnContextClassRefs =
        dto.requestedAuthnContextClassRefs;
    }

    if (typeof dto.requestedAuthnContextComparison !== 'undefined') {
      updateData.requestedAuthnContextComparison =
        dto.requestedAuthnContextComparison;
    }

    if (typeof dto.allowSignup !== 'undefined') {
      updateData.allowSignup = dto.allowSignup;
    }

    if (typeof dto.isEnabled !== 'undefined') {
      updateData.isEnabled = dto.isEnabled;
    }

    if (typeof dto.groupSync !== 'undefined') {
      updateData.groupSync = dto.groupSync;
    }

    const updated = await this.db
      .updateTable('authProviders')
      .set(updateData)
      .where('id', '=', dto.providerId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();

    this.auditService.log({
      event: AuditEvent.SSO_PROVIDER_UPDATED,
      resourceType: AuditResource.SSO_PROVIDER,
      resourceId: updated.id,
      changes: {
        before: {
          name: provider.name,
          samlUrl: provider.samlUrl,
          spEntityId: provider.spEntityId,
          spAcsUrl: provider.spAcsUrl,
          requestedAuthnContextMode: provider.requestedAuthnContextMode,
          requestedAuthnContextClassRefs:
            provider.requestedAuthnContextClassRefs,
          requestedAuthnContextComparison:
            provider.requestedAuthnContextComparison,
          isEnabled: provider.isEnabled,
          allowSignup: provider.allowSignup,
          groupSync: provider.groupSync,
        },
        after: {
          name: updated.name,
          samlUrl: updated.samlUrl,
          spEntityId: updated.spEntityId,
          spAcsUrl: updated.spAcsUrl,
          requestedAuthnContextMode: updated.requestedAuthnContextMode,
          requestedAuthnContextClassRefs:
            updated.requestedAuthnContextClassRefs,
          requestedAuthnContextComparison:
            updated.requestedAuthnContextComparison,
          isEnabled: updated.isEnabled,
          allowSignup: updated.allowSignup,
          groupSync: updated.groupSync,
        },
      },
      metadata: {
        workspaceId,
      },
    });

    return this.serializeProvider(updated);
  }

  async deleteProvider(workspaceId: string, dto: ProviderIdDto) {
    const provider = await this.findProviderById(workspaceId, dto.providerId);
    if (!provider) {
      throw new NotFoundException('SSO provider not found');
    }

    await this.db
      .deleteFrom('authProviders')
      .where('id', '=', dto.providerId)
      .where('workspaceId', '=', workspaceId)
      .execute();

    this.samlCaches.delete(provider.id);

    this.auditService.log({
      event: AuditEvent.SSO_PROVIDER_DELETED,
      resourceType: AuditResource.SSO_PROVIDER,
      resourceId: provider.id,
      changes: {
        before: {
          name: provider.name,
          type: provider.type,
        },
      },
      metadata: {
        workspaceId,
      },
    });
  }

  async buildPostLoginRedirect(
    user: User,
    relayState?: unknown,
  ): Promise<string> {
    const workspace = await this.workspaceRepo.findById(user.workspaceId);
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    const baseUrl = this.domainService.getUrl(workspace.hostname);
    const safeRedirect = this.safeRedirectPath(relayState, baseUrl);
    return safeRedirect ? `${baseUrl}${safeRedirect}` : `${baseUrl}/home`;
  }

  async issueAuthCookieAndToken(user: User): Promise<string> {
    return this.tokenService.generateAccessToken(user);
  }

  setAuthCookie(res: FastifyReply, token: string) {
    res.setCookie('authToken', token, {
      httpOnly: true,
      path: '/',
      expires: this.environmentService.getCookieExpiresIn(),
      secure: this.environmentService.isHttps(),
    });
  }

  async resolveSamlLogin(req: any, profile: any): Promise<User> {
    const providerId = req?.params?.providerId;
    if (!providerId) {
      throw new BadRequestException('Missing SSO provider id.');
    }

    const provider = await this.findProviderByIdAny(providerId);
    if (!provider) {
      throw new NotFoundException('SSO provider not found');
    }

    if (provider.type !== SAML_PROVIDER_TYPE || !provider.isEnabled) {
      throw new UnauthorizedException('SSO provider is not enabled.');
    }

    const workspace = await this.workspaceRepo.findById(provider.workspaceId);
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    const email = this.extractEmail(profile);
    if (!email) {
      throw new BadRequestException('SAML response is missing an email claim.');
    }

    const displayName = this.extractDisplayName(profile, email);
    const providerUserId = this.extractProviderUserId(profile, email);
    const groups = this.extractGroups(profile);

    const user = await executeTx(this.db, async (trx) => {
      const existingLink = await trx
        .selectFrom('authAccounts')
        .selectAll()
        .where('workspaceId', '=', workspace.id)
        .where('authProviderId', '=', provider.id)
        .where('providerUserId', '=', providerUserId)
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
          throw new UnauthorizedException('Linked SSO account is disabled.');
        }
      } else {
        resolvedUser = await this.userRepo.findByEmail(email, workspace.id, {
          trx,
        });

        if (!resolvedUser) {
          if (!provider.allowSignup) {
            throw new ForbiddenException(
              'This workspace does not allow SSO signup.',
            );
          }

          resolvedUser = await this.userRepo.insertUser(
            {
              name: displayName,
              email,
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
        } else {
          if (isUserDisabled(resolvedUser)) {
            throw new UnauthorizedException('User account is disabled.');
          }
        }

        const linkExists = await trx
          .selectFrom('authAccounts')
          .select('id')
          .where('workspaceId', '=', workspace.id)
          .where('authProviderId', '=', provider.id)
          .where('providerUserId', '=', providerUserId)
          .executeTakeFirst();

        if (!linkExists) {
          await trx
            .insertInto('authAccounts')
            .values({
              userId: resolvedUser.id,
              providerUserId,
              authProviderId: provider.id,
              workspaceId: workspace.id,
            })
            .execute();
        }
      }

      if (!resolvedUser.emailVerifiedAt) {
        await this.userRepo.updateUser(
          {
            emailVerifiedAt: new Date(),
          },
          resolvedUser.id,
          workspace.id,
          trx,
        );
        resolvedUser.emailVerifiedAt = new Date();
      }

      if (
        displayName &&
        this.shouldUpdateDisplayName(resolvedUser.name, email)
      ) {
        await this.userRepo.updateUser(
          {
            name: displayName,
          },
          resolvedUser.id,
          workspace.id,
          trx,
        );
        resolvedUser.name = displayName;
      }

      if (provider.groupSync && groups.length > 0) {
        await this.syncGroups(resolvedUser, groups, workspace.id, trx);
      }

      await this.userRepo.updateUser(
        {
          lastLoginAt: new Date(),
        },
        resolvedUser.id,
        workspace.id,
        trx,
      );

      resolvedUser.lastLoginAt = new Date();
      return resolvedUser;
    });

    this.auditService.log({
      event: AuditEvent.USER_LOGIN,
      resourceType: AuditResource.USER,
      resourceId: user.id,
      metadata: {
        source: 'saml',
        providerId,
      },
    });

    return user;
  }

  async resolveProviderIdForAcs(req: any): Promise<string> {
    let requestUrl: string;
    try {
      requestUrl = buildRequestPublicUrl(req);
    } catch {
      throw new NotFoundException('SAML callback not found.');
    }

    const callbackPath = getSamlAcsPath(requestUrl);
    const candidates = await this.db
      .selectFrom('authProviders')
      .select(['id', 'spAcsUrl'])
      .where('type', '=', SAML_PROVIDER_TYPE)
      .where('spAcsPath', '=', callbackPath)
      .where('isEnabled', '=', true)
      .where('deletedAt', 'is', null)
      .execute();

    const provider = candidates.find(
      (candidate) =>
        candidate.spAcsUrl &&
        canonicalizeSamlAcsUrl(candidate.spAcsUrl) ===
          canonicalizeSamlAcsUrl(requestUrl),
    );

    if (!provider) {
      throw new NotFoundException('SAML callback not found.');
    }

    return provider.id;
  }

  async getSamlMetadata(providerId: string): Promise<string> {
    const provider = await this.findProviderByIdAny(providerId);
    if (!provider || provider.type !== SAML_PROVIDER_TYPE) {
      throw new NotFoundException('SSO provider not found');
    }

    const workspace = await this.workspaceRepo.findById(provider.workspaceId);
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    const config = this.getEffectiveSamlConfig(
      provider,
      this.domainService.getUrl(workspace.hostname),
    );

    return buildSamlMetadata({
      entityId: config.entityId,
      acsUrl: config.acsUrl,
      acsBinding: config.acsBinding,
      sloUrl: config.spSloUrl,
      nameIdFormat: config.nameIdFormat,
    });
  }

  private async buildSamlOptions(req: any) {
    const providerId = req?.params?.providerId;
    if (!providerId) {
      throw new BadRequestException('Missing SSO provider id.');
    }

    const provider = await this.findProviderByIdAny(providerId);
    if (!provider) {
      throw new NotFoundException('SSO provider not found');
    }

    if (provider.type !== SAML_PROVIDER_TYPE || !provider.isEnabled) {
      throw new UnauthorizedException('SSO provider is not enabled.');
    }

    if (!provider.samlUrl || !provider.samlCertificate) {
      throw new BadRequestException('SAML provider is not fully configured.');
    }

    const workspace = await this.workspaceRepo.findById(provider.workspaceId);
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    const config = this.getEffectiveSamlConfig(
      provider,
      this.domainService.getUrl(workspace.hostname),
    );

    return {
      callbackUrl: config.acsUrl,
      entryPoint: provider.samlUrl,
      issuer: config.entityId,
      audience: config.entityId,
      idpCert: normalizeSamlCertificate(provider.samlCertificate),
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: true,
      identifierFormat: config.nameIdFormat,
      idpIssuer: provider.idpEntityId ?? undefined,
      logoutUrl: provider.idpSloUrl ?? undefined,
      logoutCallbackUrl: config.spSloUrl ?? undefined,
      validateInResponseTo: 'ifPresent',
      requestIdExpirationPeriodMs: SAML_REQUEST_ID_TTL_MS,
      cacheProvider: this.getSamlCacheProvider(provider.id),
      ...buildSamlAuthnContextOptions(provider),
    };
  }

  private getSamlAuthnContextClassRefs(provider: AuthProvider): string[] {
    return Array.isArray(provider.requestedAuthnContextClassRefs)
      ? provider.requestedAuthnContextClassRefs.filter(
          (value): value is string => typeof value === 'string',
        )
      : [];
  }

  private getEffectiveSamlConfig(provider: AuthProvider, baseUrl: string) {
    return {
      entityId: provider.spEntityId ?? buildSamlEntityId(baseUrl, provider.id),
      acsUrl: provider.spAcsUrl ?? buildSamlCallbackUrl(baseUrl, provider.id),
      acsBinding: provider.spAcsBinding ?? SAML_HTTP_POST_BINDING,
      spSloUrl: provider.spSloUrl,
      nameIdFormat: provider.nameIdFormat ?? SAML_DEFAULT_NAME_ID_FORMAT,
    };
  }

  private getSamlCacheProvider(providerId: string): SamlCacheProvider {
    const existing = this.samlCaches.get(providerId);
    if (existing) {
      return existing;
    }

    const providerCache: SamlCacheProvider = {
      saveAsync: async (key: string, value: string) => {
        const cacheKey = this.getSamlRequestCacheKey(providerId, key);
        const entry = {
          value,
          createdAt: Date.now(),
        };
        const result = await this.redis.set(
          cacheKey,
          JSON.stringify(entry),
          'PX',
          SAML_REQUEST_ID_TTL_MS,
          'NX',
        );
        return result === 'OK' ? entry : null;
      },
      getAsync: async (key: string) => {
        const rawEntry = await this.redis.get(
          this.getSamlRequestCacheKey(providerId, key),
        );
        if (!rawEntry) {
          return null;
        }

        try {
          const entry = JSON.parse(rawEntry) as Partial<SamlCacheEntry>;
          return typeof entry.value === 'string' ? entry.value : null;
        } catch (error) {
          await this.redis.del(this.getSamlRequestCacheKey(providerId, key));
          return null;
        }
      },
      removeAsync: async (key: string | null) => {
        if (!key) {
          return null;
        }

        const deleted = await this.redis.del(
          this.getSamlRequestCacheKey(providerId, key),
        );
        return deleted > 0 ? key : null;
      },
    };

    this.samlCaches.set(providerId, providerCache);
    return providerCache;
  }

  private getSamlRequestCacheKey(
    providerId: string,
    requestId: string,
  ): string {
    return `sso:saml:request:${providerId}:${requestId}`;
  }

  private async syncGroups(
    user: User,
    groups: string[],
    workspaceId: string,
    trx?: KyselyTransaction,
  ) {
    const uniqueGroups = [...new Set(groups)];
    for (const groupName of uniqueGroups) {
      const existingGroup = await this.groupRepo.findByName(
        groupName,
        workspaceId,
        {
          trx,
        },
      );

      if (!existingGroup) {
        continue;
      }

      const groupUserExists = await this.groupUserRepo.getGroupUserById(
        user.id,
        existingGroup.id,
        trx,
      );

      if (!groupUserExists) {
        await this.groupUserRepo.insertGroupUser(
          {
            userId: user.id,
            groupId: existingGroup.id,
          },
          trx,
        );
      }
    }
  }

  private extractEmail(profile: any): string | null {
    const candidates = [
      profile?.email,
      profile?.mail,
      profile?.upn,
      profile?.userPrincipalName,
      profile?.preferred_username,
      profile?.nameID,
      profile?.[
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'
      ],
      profile?.['http://schemas.microsoft.com/identity/claims/emailaddress'],
      profile?.['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'],
    ];

    for (const candidate of candidates) {
      const value = this.firstString(candidate);
      if (value && value.includes('@')) {
        return value.toLowerCase();
      }
    }

    return null;
  }

  private extractDisplayName(profile: any, email: string): string {
    const candidates = [
      profile?.displayName,
      profile?.name,
      profile?.givenName && profile?.sn
        ? `${profile.givenName} ${profile.sn}`
        : undefined,
      profile?.given_name && profile?.family_name
        ? `${profile.given_name} ${profile.family_name}`
        : undefined,
      profile?.['http://schemas.microsoft.com/identity/claims/displayname'],
    ];

    for (const candidate of candidates) {
      const value = this.firstString(candidate);
      if (value) {
        return value;
      }
    }

    return email.split('@')[0];
  }

  private extractProviderUserId(profile: any, email: string): string {
    const candidates = [
      profile?.nameID,
      profile?.nameId,
      profile?.sub,
      profile?.email,
      email,
    ];

    for (const candidate of candidates) {
      const value = this.firstString(candidate);
      if (value) {
        return value.includes('@') ? value.toLowerCase() : value;
      }
    }

    throw new BadRequestException(
      'SAML response is missing a stable subject identifier.',
    );
  }

  private extractGroups(profile: any): string[] {
    const candidates = [
      profile?.groups,
      profile?.group,
      profile?.memberOf,
      profile?.roles,
      profile?.[
        'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups'
      ],
      profile?.['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'],
    ];

    const values: string[] = [];
    for (const candidate of candidates) {
      values.push(...this.flattenStrings(candidate));
    }

    return [
      ...new Set(values.map((value) => value.trim()).filter(Boolean)),
    ].filter((value) => value.length >= 2 && value.length <= 100);
  }

  private flattenStrings(value: unknown): string[] {
    if (!value) {
      return [];
    }

    if (Array.isArray(value)) {
      return value.flatMap((item) => this.flattenStrings(item));
    }

    if (typeof value === 'string') {
      return value
        .split(/[;,]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }

    if (typeof value === 'object') {
      return Object.values(value as Record<string, unknown>).flatMap((item) =>
        this.flattenStrings(item),
      );
    }

    return [String(value)];
  }

  private firstString(value: unknown): string | null {
    if (!value) {
      return null;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const candidate = this.firstString(item);
        if (candidate) {
          return candidate;
        }
      }
      return null;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    return String(value);
  }

  private safeRedirectPath(target: unknown, appUrl: string): string | null {
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

  private async findProviderById(
    workspaceId: string,
    providerId: string,
  ): Promise<AuthProvider | null> {
    return this.db
      .selectFrom('authProviders')
      .selectAll()
      .where('id', '=', providerId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  private async findProviderByIdAny(
    providerId: string,
  ): Promise<AuthProvider | null> {
    return this.db
      .selectFrom('authProviders')
      .selectAll()
      .where('id', '=', providerId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  private shouldUpdateDisplayName(
    currentName: string | null,
    email: string,
  ): boolean {
    if (!currentName) return true;

    const defaultName = email.split('@')[0].toLowerCase();
    return currentName.toLowerCase() === defaultName;
  }

  private serializeProvider(provider: AuthProvider) {
    return {
      ...provider,
      spAcsUrlKey: undefined,
      providerId: provider.id,
    };
  }
}
