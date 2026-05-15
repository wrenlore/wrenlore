import { BadRequestException } from '@nestjs/common';
import { hashPassword } from '../../../common/helpers';
import { MfaManagementService } from './mfa-management.service';

describe('MfaManagementService', () => {
  const workspaceId = 'workspace-id';
  const userId = 'user-id';
  const trx = { trx: true };

  const createService = async () => {
    const user = {
      id: userId,
      workspaceId,
      email: 'person@example.com',
      password: await hashPassword('correct-password'),
    };
    const userRepo = {
      findById: jest.fn().mockResolvedValue(user),
    };
    const userMfaRepo = {
      findByUserId: jest.fn(),
      insertTotpMfa: jest.fn().mockResolvedValue({ id: 'mfa-id' }),
      deleteById: jest.fn(),
      deleteByUserId: jest.fn(),
      enableMfa: jest.fn(),
      deleteRecoveryCodesByMfaId: jest.fn(),
      insertRecoveryCodeHashes: jest.fn(),
    };
    const mfaService = {
      generateTotpSetupData: jest.fn().mockReturnValue({
        issuer: 'WrenLore',
        secret: 'TOTPSECRET',
        uri: 'otpauth://totp/WrenLore:person@example.com',
        encryptedSecret: 'encrypted-secret',
      }),
      decryptTotpSecret: jest.fn().mockReturnValue('TOTPSECRET'),
      verifyTotpToken: jest.fn().mockReturnValue(true),
      generateRecoveryCodes: jest
        .fn()
        .mockReturnValue(['AAAA-BBBB-CCCC-DDDD', 'EEEE-FFFF-GGGG-HHHH']),
      hashRecoveryCodes: jest
        .fn()
        .mockResolvedValue(['hash-1', 'hash-2']),
    };
    const db = {
      transaction: () => ({
        execute: async (callback: any) => callback(trx),
      }),
    };
    const auditService = {
      log: jest.fn(),
    };

    const service = new MfaManagementService(
      userRepo as any,
      userMfaRepo as any,
      mfaService as any,
      db as any,
      auditService as any,
    );

    return { service, userRepo, userMfaRepo, mfaService, auditService };
  };

  it('starts setup by storing an encrypted pending secret without enabling MFA', async () => {
    const { service, userMfaRepo, mfaService } = await createService();
    userMfaRepo.findByUserId.mockResolvedValue(null);

    const result = await service.startSetup(userId, workspaceId);

    expect(result).toEqual({
      issuer: 'WrenLore',
      accountLabel: 'person@example.com',
      secret: 'TOTPSECRET',
      uri: 'otpauth://totp/WrenLore:person@example.com',
    });
    expect(mfaService.generateTotpSetupData).toHaveBeenCalledWith(
      'person@example.com',
      'WrenLore',
    );
    expect(userMfaRepo.insertTotpMfa).toHaveBeenCalledWith(
      {
        userId,
        workspaceId,
        totpSecret: 'encrypted-secret',
      },
      trx,
    );
  });

  it('rejects invalid confirmation tokens without enabling MFA', async () => {
    const { service, userMfaRepo, mfaService } = await createService();
    userMfaRepo.findByUserId.mockResolvedValue({
      id: 'mfa-id',
      totpSecret: 'encrypted-secret',
      enabledAt: null,
    });
    mfaService.verifyTotpToken.mockReturnValue(false);

    await expect(
      service.confirmSetup(userId, workspaceId, '000000'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(userMfaRepo.enableMfa).not.toHaveBeenCalled();
    expect(userMfaRepo.insertRecoveryCodeHashes).not.toHaveBeenCalled();
  });

  it('confirms setup, hashes recovery codes, and emits an audit event', async () => {
    const { service, userMfaRepo, auditService } = await createService();
    userMfaRepo.findByUserId.mockResolvedValue({
      id: 'mfa-id',
      totpSecret: 'encrypted-secret',
      enabledAt: null,
    });

    const result = await service.confirmSetup(userId, workspaceId, '123456');

    expect(result.recoveryCodes).toEqual([
      'AAAA-BBBB-CCCC-DDDD',
      'EEEE-FFFF-GGGG-HHHH',
    ]);
    expect(userMfaRepo.enableMfa).toHaveBeenCalledWith(
      'mfa-id',
      expect.any(Date),
      trx,
    );
    expect(userMfaRepo.insertRecoveryCodeHashes).toHaveBeenCalledWith(
      'mfa-id',
      ['hash-1', 'hash-2'],
      trx,
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.mfa_enabled',
        resourceType: 'user',
        resourceId: userId,
      }),
    );
  });

  it('requires the current password before disabling MFA', async () => {
    const { service, userMfaRepo, auditService } = await createService();
    userMfaRepo.findByUserId.mockResolvedValue({
      id: 'mfa-id',
      enabledAt: new Date(),
    });

    await expect(
      service.disable(userId, workspaceId, 'wrong-password'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(userMfaRepo.deleteByUserId).not.toHaveBeenCalled();

    await service.disable(userId, workspaceId, 'correct-password');
    expect(userMfaRepo.deleteByUserId).toHaveBeenCalledWith(
      userId,
      workspaceId,
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.mfa_disabled',
        resourceType: 'user',
        resourceId: userId,
      }),
    );
  });

  it('replaces old recovery code hashes when regenerating codes', async () => {
    const { service, userMfaRepo, auditService } = await createService();
    userMfaRepo.findByUserId.mockResolvedValue({
      id: 'mfa-id',
      enabledAt: new Date(),
    });

    const result = await service.regenerateRecoveryCodes(
      userId,
      workspaceId,
      'correct-password',
    );

    expect(result.recoveryCodes).toHaveLength(2);
    expect(userMfaRepo.deleteRecoveryCodesByMfaId).toHaveBeenCalledWith(
      'mfa-id',
      trx,
    );
    expect(userMfaRepo.insertRecoveryCodeHashes).toHaveBeenCalledWith(
      'mfa-id',
      ['hash-1', 'hash-2'],
      trx,
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.mfa_recovery_codes_regenerated',
        resourceType: 'user',
        resourceId: userId,
      }),
    );
  });
});
