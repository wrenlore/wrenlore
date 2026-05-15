import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { hashPassword } from '../../../common/helpers';
import { MfaService } from './mfa.service';

jest.mock('./signup.service', () => ({
  SignupService: class SignupService {},
}));
jest.mock(
  '@wrenlore/transactional/emails/change-password-email',
  () => ({
    __esModule: true,
    default: jest.fn(),
  }),
  { virtual: true },
);
jest.mock(
  '@wrenlore/transactional/emails/forgot-password-email',
  () => ({
    __esModule: true,
    default: jest.fn(),
  }),
  { virtual: true },
);

import { AuthService } from './auth.service';

describe('AuthService MFA login flow', () => {
  const workspaceId = 'workspace-id';
  const userId = 'user-id';

  const createService = async (opts?: {
    mfaEnabled?: boolean;
    mfaRecord?: { id: string; enabledAt: Date | null; confirmedAt?: Date | null };
    requireLocalMfa?: boolean;
  }) => {
    const mfaRecord =
      opts?.mfaRecord ??
      (opts?.mfaEnabled
        ? {
            id: 'mfa-id',
            enabledAt: new Date(),
            confirmedAt: new Date(),
          }
        : null);
    const user = {
      id: userId,
      email: 'person@example.com',
      workspaceId,
      password: await hashPassword('correct-password'),
      emailVerifiedAt: new Date(),
      mfa: mfaRecord,
    };
    const userRepo = {
      findByEmail: jest.fn().mockResolvedValue(user),
      findById: jest.fn().mockResolvedValue(user),
      updateLastLogin: jest.fn(),
    };
    const tokenService = {
      generateAccessToken: jest.fn().mockResolvedValue('access-token'),
      generateMfaToken: jest.fn().mockResolvedValue('mfa-token'),
      verifyJwt: jest.fn().mockResolvedValue({
        sub: userId,
        workspaceId,
        type: 'mfa_token',
      }),
    };
    const userMfaRepo = {
      findByUserId: jest.fn().mockResolvedValue(
        mfaRecord
          ? {
              ...mfaRecord,
              userId,
              workspaceId,
              totpSecret: 'encrypted-secret',
            }
          : null,
      ),
      findRecoveryCodesByMfaId: jest.fn(),
      markRecoveryCodeUsed: jest.fn().mockResolvedValue({
        id: 'recovery-code-id',
        usedAt: new Date(),
      }),
    };
    const mfaService = new MfaService({
      encrypt: jest.fn(),
      decrypt: jest.fn().mockReturnValue('TOTPSECRET'),
    } as any);
    jest.spyOn(mfaService, 'verifyTotpToken').mockReturnValue(true);
    const environmentService = {
      isCloud: jest.fn().mockReturnValue(false),
      getAppSecret: jest.fn().mockReturnValue('app-secret'),
    };
    const auditService = {
      log: jest.fn(),
      setActorId: jest.fn(),
    };
    const mfaPolicy = {
      requireForLocalAccounts: opts?.requireLocalMfa === true,
    };
    const instanceSettingRepo = {
      getMfaPolicy: jest.fn().mockResolvedValue(mfaPolicy),
      isLocalMfaRequired: jest
        .fn()
        .mockResolvedValue(mfaPolicy.requireForLocalAccounts),
    };
    const db = {};

    const service = new AuthService(
      {} as any,
      tokenService as any,
      userRepo as any,
      {} as any,
      {} as any,
      {} as any,
      environmentService as any,
      userMfaRepo as any,
      mfaService,
      instanceSettingRepo as any,
      db as any,
      auditService as any,
    );

    return {
      service,
      userRepo,
      tokenService,
      userMfaRepo,
      mfaService,
      auditService,
      instanceSettingRepo,
    };
  };

  it('keeps password login unchanged for users without MFA', async () => {
    const { service, userRepo, tokenService } = await createService();

    await expect(
      service.login(
        { email: 'person@example.com', password: 'correct-password' },
        workspaceId,
      ),
    ).resolves.toBe('access-token');

    expect(userRepo.updateLastLogin).toHaveBeenCalledWith(userId, workspaceId);
    expect(tokenService.generateAccessToken).toHaveBeenCalled();
    expect(tokenService.generateMfaToken).not.toHaveBeenCalled();
  });

  it('logs in normally when MFA is not required even if user MFA is enrolled', async () => {
    const { service, tokenService, userMfaRepo } = await createService({
      mfaEnabled: true,
    });

    await expect(
      service.login(
        { email: 'person@example.com', password: 'correct-password' },
        workspaceId,
      ),
    ).resolves.toBe('access-token');

    expect(tokenService.generateAccessToken).toHaveBeenCalled();
    expect(tokenService.generateMfaToken).not.toHaveBeenCalled();
    expect(userMfaRepo.findByUserId).not.toHaveBeenCalled();
  });

  it('does not require a challenge for disabled MFA when local MFA policy is off', async () => {
    const { service, tokenService } = await createService({
      mfaRecord: {
        id: 'mfa-id',
        enabledAt: null,
        confirmedAt: null,
      },
    });

    await expect(
      service.login(
        { email: 'person@example.com', password: 'correct-password' },
        workspaceId,
      ),
    ).resolves.toBe('access-token');

    expect(tokenService.generateAccessToken).toHaveBeenCalled();
    expect(tokenService.generateMfaToken).not.toHaveBeenCalled();
  });

  it('routes disabled MFA users to setup, not challenge, when local MFA policy is on', async () => {
    const { service, tokenService } = await createService({
      requireLocalMfa: true,
      mfaRecord: {
        id: 'mfa-id',
        enabledAt: null,
        confirmedAt: null,
      },
    });

    await expect(
      service.login(
        { email: 'person@example.com', password: 'correct-password' },
        workspaceId,
      ),
    ).resolves.toEqual({
      requiresMfaSetup: true,
      authToken: 'access-token',
    });

    expect(tokenService.generateAccessToken).toHaveBeenCalled();
    expect(tokenService.generateMfaToken).not.toHaveBeenCalled();
  });

  it('requires MFA setup after password login when local MFA policy is enabled', async () => {
    const { service, userRepo, tokenService } = await createService({
      requireLocalMfa: true,
    });

    await expect(
      service.login(
        { email: 'person@example.com', password: 'correct-password' },
        workspaceId,
      ),
    ).resolves.toEqual({
      requiresMfaSetup: true,
      authToken: 'access-token',
    });

    expect(userRepo.updateLastLogin).toHaveBeenCalledWith(userId, workspaceId);
    expect(tokenService.generateAccessToken).toHaveBeenCalled();
    expect(tokenService.generateMfaToken).not.toHaveBeenCalled();
  });

  it('requires an MFA challenge after password login for enrolled users when MFA is required', async () => {
    const { service, userRepo, tokenService } = await createService({
      requireLocalMfa: true,
      mfaEnabled: true,
    });

    await expect(
      service.login(
        { email: 'person@example.com', password: 'correct-password' },
        workspaceId,
      ),
    ).resolves.toEqual({
      userHasMfa: true,
      mfaToken: 'mfa-token',
    });

    expect(tokenService.generateMfaToken).toHaveBeenCalled();
    expect(tokenService.generateAccessToken).not.toHaveBeenCalled();
    expect(userRepo.updateLastLogin).not.toHaveBeenCalled();
  });

  it('reactivates existing user MFA when MFA becomes required again', async () => {
    const { service, tokenService } = await createService({
      requireLocalMfa: true,
      mfaEnabled: true,
    });

    await expect(
      service.login(
        { email: 'person@example.com', password: 'correct-password' },
        workspaceId,
      ),
    ).resolves.toEqual({
      userHasMfa: true,
      mfaToken: 'mfa-token',
    });

    expect(tokenService.generateMfaToken).toHaveBeenCalled();
    expect(tokenService.generateAccessToken).not.toHaveBeenCalled();
  });

  it('routes stale existing MFA enrollment to setup when MFA becomes required again', async () => {
    const {
      service,
      tokenService,
      mfaService,
      instanceSettingRepo,
      userMfaRepo,
    } = await createService({
      mfaEnabled: true,
    });
    instanceSettingRepo.isLocalMfaRequired
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    jest.spyOn(mfaService, 'decryptTotpSecret').mockImplementation(() => {
      throw new Error('invalid encrypted secret');
    });

    await expect(
      service.login(
        { email: 'person@example.com', password: 'correct-password' },
        workspaceId,
      ),
    ).resolves.toBe('access-token');
    expect(userMfaRepo.findByUserId).not.toHaveBeenCalled();

    await expect(
      service.login(
        { email: 'person@example.com', password: 'correct-password' },
        workspaceId,
      ),
    ).resolves.toEqual({
      requiresMfaSetup: true,
      authToken: 'access-token',
    });

    expect(tokenService.generateMfaToken).not.toHaveBeenCalled();
  });

  it('does not return a raw server error for an unusable MFA secret during challenge', async () => {
    const { service, tokenService, mfaService, auditService } =
      await createService({ requireLocalMfa: true, mfaEnabled: true });
    jest.spyOn(mfaService, 'decryptTotpSecret').mockImplementation(() => {
      throw new Error('invalid encrypted secret');
    });

    await expect(
      service.completeMfaLogin('mfa-token', '123456'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(tokenService.generateAccessToken).not.toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.mfa_challenge_failed',
        metadata: { method: 'totp_unusable' },
      }),
    );
  });

  it('completes login with a valid TOTP token', async () => {
    const { service, tokenService, mfaService, auditService } =
      await createService({ requireLocalMfa: true, mfaEnabled: true });

    await expect(
      service.completeMfaLogin('mfa-token', '123456'),
    ).resolves.toEqual({
      authToken: 'access-token',
    });

    expect(mfaService.verifyTotpToken).toHaveBeenCalledWith(
      'TOTPSECRET',
      '123456',
    );
    expect(tokenService.generateAccessToken).toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.mfa_challenge_succeeded',
        metadata: { method: 'totp' },
      }),
    );
  });

  it('rejects MFA challenge completion when MFA is not required', async () => {
    const { service, tokenService } = await createService({
      mfaEnabled: true,
    });

    await expect(
      service.completeMfaLogin('mfa-token', '123456'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tokenService.generateAccessToken).not.toHaveBeenCalled();
  });

  it('rejects invalid TOTP tokens without issuing a session', async () => {
    const { service, tokenService, mfaService, auditService } =
      await createService({ requireLocalMfa: true, mfaEnabled: true });
    jest.spyOn(mfaService, 'verifyTotpToken').mockReturnValue(false);

    await expect(
      service.completeMfaLogin('mfa-token', '000000'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(tokenService.generateAccessToken).not.toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.mfa_challenge_failed',
        metadata: { method: 'totp' },
      }),
    );
  });

  it('completes login once with an unused recovery code and consumes it', async () => {
    const { service, userMfaRepo, mfaService } = await createService({
      requireLocalMfa: true,
      mfaEnabled: true,
    });
    const codeHash = await mfaService.hashRecoveryCode(
      'AAAA-BBBB-CCCC-DDDD',
    );
    userMfaRepo.findRecoveryCodesByMfaId
      .mockResolvedValueOnce([
        {
          id: 'recovery-code-id',
          codeHash,
          usedAt: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'recovery-code-id',
          codeHash,
          usedAt: new Date(),
        },
      ]);

    await expect(
      service.completeMfaRecoveryLogin(
        'mfa-token',
        'AAAA-BBBB-CCCC-DDDD',
      ),
    ).resolves.toEqual({ authToken: 'access-token' });
    expect(userMfaRepo.markRecoveryCodeUsed).toHaveBeenCalledWith(
      'recovery-code-id',
    );

    await expect(
      service.completeMfaRecoveryLogin(
        'mfa-token',
        'AAAA-BBBB-CCCC-DDDD',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
