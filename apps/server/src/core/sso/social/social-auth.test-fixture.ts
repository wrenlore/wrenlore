import { AuthService } from '../../auth/services/auth.service';
import { SocialAuthService, SocialAuthFlowError } from './social-auth.service';

export const providerId = '019e6a1c-3969-704e-b0fb-57549f2cb3ef';
export const workspaceId = '019e6a1c-3969-704e-b0fb-57549f2cb3ee';
export const userId = '019e6a1c-3969-704e-b0fb-57549f2cb3ef';
export const browserBinding = 'test-browser-secret';
export const sessionToken = 'test-session-token';
export const baseUrl = 'https://tenant.example.com';

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
      return queue.length ? ((queue.shift() as unknown[]) ?? []) : [];
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
      columns: () => target,
      doUpdateSet: () => target,
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

export function githubProviderRow(overrides: Record<string, unknown> = {}) {
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

export function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: workspaceId,
    hostname: 'tenant',
    enforceSso: false,
    emailDomains: [],
    ...overrides,
  } as any;
}

export function makeUser(overrides: Record<string, unknown> = {}) {
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

export function identity(overrides: Record<string, unknown> = {}) {
  return {
    providerUserId: 'gh-123',
    email: 'user@example.com',
    emailVerified: true,
    displayName: 'User',
    ...overrides,
  };
}

export function createService(
  options: { provider?: any; cloud?: boolean } = {},
) {
  const db = new FakeDb();
  const redis = new FakeRedis();

  const userRepo = {
    findById: jest.fn().mockResolvedValue(makeUser()),
    findByEmail: jest.fn().mockResolvedValue(null),
    insertUser: jest.fn().mockImplementation(async (data: any) => ({
      id: 'new-user-id',
      ...data,
    })),
    updateLastLogin: jest.fn(),
    updateUser: jest.fn().mockResolvedValue(undefined),
  };
  const userMfaRepo = { findByUserId: jest.fn().mockResolvedValue(null) };
  const instanceSettingRepo = {
    isLocalMfaRequired: jest.fn().mockResolvedValue(false),
  };
  const groupUserRepo = { addUserToDefaultGroup: jest.fn() };
  const workspaceService = { addUserToWorkspace: jest.fn() };
  const tokenService = {
    verifyJwt: jest.fn().mockResolvedValue({ sub: userId, workspaceId }),
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
    buildAuthorizeUrl: jest.fn().mockImplementation(async ({ state }: any) => ({
      authorizeUrl: `https://github.com/login/oauth/authorize?state=${state}&client_id=client-id&scope=read:user+user:email`,
    })),
    resolveIdentity: jest.fn().mockResolvedValue(identity()),
  };
  const googleDriver = {
    type: 'google',
    buildAuthorizeUrl: jest.fn().mockImplementation(async ({ state }: any) => ({
      authorizeUrl: `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
    })),
    resolveIdentity: jest.fn().mockResolvedValue(identity()),
  };
  const auditService = { log: jest.fn(), setActorId: jest.fn() };
  const redisService = { getOrThrow: jest.fn().mockReturnValue(redis) };

  const authService = new AuthService(
    {} as any,
    tokenService as any,
    userRepo as any,
    {} as any,
    {} as any,
    domainService as any,
    environmentService as any,
    userMfaRepo as any,
    mfaService as any,
    instanceSettingRepo as any,
    db as any,
    auditService as any,
  );
  const service = new SocialAuthService(
    db as any,
    userRepo as any,
    groupUserRepo as any,
    workspaceService as any,
    tokenService as any,
    authService,
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
