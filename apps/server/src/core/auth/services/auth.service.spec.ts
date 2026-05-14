import { UnauthorizedException } from '@nestjs/common';
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

  const createService = async (opts?: { mfaEnabled?: boolean }) => {
    const user = {
      id: userId,
      email: 'person@example.com',
      workspaceId,
      password: await hashPassword('correct-password'),
      emailVerifiedAt: new Date(),
      mfa: opts?.mfaEnabled
        ? {
            id: 'mfa-id',
            enabledAt: new Date(),
            confirmedAt: new Date(),
          }
        : null,
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
      findByUserId: jest.fn().mockResolvedValue({
        id: 'mfa-id',
        userId,
        workspaceId,
        enabledAt: new Date(),
        totpSecret: 'encrypted-secret',
      }),
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

  it('requires an MFA challenge after password login for MFA-enabled users', async () => {
    const { service, userRepo, tokenService } = await createService({
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

  it('completes login with a valid TOTP token', async () => {
    const { service, tokenService, mfaService, auditService } =
      await createService({ mfaEnabled: true });

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

  it('rejects invalid TOTP tokens without issuing a session', async () => {
    const { service, tokenService, mfaService, auditService } =
      await createService({ mfaEnabled: true });
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
