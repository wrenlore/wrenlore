import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { UserRepo } from '@wrenlore/db/repos/user/user.repo';
import { UserMfaRepo } from '@wrenlore/db/repos/user/user-mfa.repo';
import { KyselyDB } from '@wrenlore/db/types/kysely.types';
import { executeTx } from '@wrenlore/db/utils';
import { comparePasswordHash, isUserDisabled } from '../../../common/helpers';
import { AuditEvent, AuditResource } from '../../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../../integrations/audit/audit.service';
import { MfaService } from './mfa.service';
import { InstanceSettingRepo } from '@wrenlore/db/repos/instance-setting/instance-setting.repo';

const MFA_ISSUER = 'WrenLore';

@Injectable()
export class MfaManagementService {
  constructor(
    private readonly userRepo: UserRepo,
    private readonly userMfaRepo: UserMfaRepo,
    private readonly mfaService: MfaService,
    private readonly instanceSettingRepo: InstanceSettingRepo,
    @InjectKysely() private readonly db: KyselyDB,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  async startSetup(userId: string, workspaceId: string) {
    await this.assertMfaRequired();
    const user = await this.getLocalPasswordUser(userId, workspaceId);
    const existingMfa = await this.userMfaRepo.findByUserId(
      userId,
      workspaceId,
      { includeTotpSecret: true },
    );

    if (existingMfa?.enabledAt) {
      throw new BadRequestException('MFA is already enabled');
    }

    const accountLabel = user.email;
    const setup = this.mfaService.generateTotpSetupData(
      accountLabel,
      MFA_ISSUER,
    );

    await executeTx(this.db, async (trx) => {
      if (existingMfa) {
        await this.userMfaRepo.deleteById(existingMfa.id, trx);
      }

      await this.userMfaRepo.insertTotpMfa(
        {
          userId,
          workspaceId,
          totpSecret: setup.encryptedSecret,
        },
        trx,
      );
    });

    return {
      issuer: MFA_ISSUER,
      accountLabel,
      secret: setup.secret,
      uri: setup.uri,
    };
  }

  async confirmSetup(userId: string, workspaceId: string, token: string) {
    await this.assertMfaRequired();
    await this.getLocalPasswordUser(userId, workspaceId);
    const mfa = await this.getPendingMfa(userId, workspaceId);
    const secret = this.mfaService.decryptTotpSecret(mfa.totpSecret);

    if (!this.mfaService.verifyTotpToken(secret, token)) {
      throw new BadRequestException('Invalid MFA token');
    }

    const recoveryCodes = this.mfaService.generateRecoveryCodes();
    const recoveryCodeHashes =
      await this.mfaService.hashRecoveryCodes(recoveryCodes);
    const now = new Date();

    await executeTx(this.db, async (trx) => {
      await this.userMfaRepo.enableMfa(mfa.id, now, trx);
      await this.userMfaRepo.deleteRecoveryCodesByMfaId(mfa.id, trx);
      await this.userMfaRepo.insertRecoveryCodeHashes(
        mfa.id,
        recoveryCodeHashes,
        trx,
      );
    });

    this.auditService.log({
      event: AuditEvent.USER_MFA_ENABLED,
      resourceType: AuditResource.USER,
      resourceId: userId,
      metadata: { method: 'totp' },
    });

    return { recoveryCodes };
  }

  async disable(userId: string, workspaceId: string, currentPassword: string) {
    await this.verifyCurrentPassword(userId, workspaceId, currentPassword);
    throw new BadRequestException('MFA is controlled by an administrator');
  }

  async regenerateRecoveryCodes(
    userId: string,
    workspaceId: string,
    currentPassword: string,
  ) {
    await this.assertMfaRequired();
    await this.verifyCurrentPassword(userId, workspaceId, currentPassword);
    const mfa = await this.getEnabledMfa(userId, workspaceId);
    const recoveryCodes = this.mfaService.generateRecoveryCodes();
    const recoveryCodeHashes =
      await this.mfaService.hashRecoveryCodes(recoveryCodes);

    await executeTx(this.db, async (trx) => {
      await this.userMfaRepo.deleteRecoveryCodesByMfaId(mfa.id, trx);
      await this.userMfaRepo.insertRecoveryCodeHashes(
        mfa.id,
        recoveryCodeHashes,
        trx,
      );
    });

    this.auditService.log({
      event: AuditEvent.USER_MFA_RECOVERY_CODES_REGENERATED,
      resourceType: AuditResource.USER,
      resourceId: userId,
      metadata: { method: 'totp' },
    });

    return { recoveryCodes };
  }

  private async getPendingMfa(userId: string, workspaceId: string) {
    const mfa = await this.userMfaRepo.findByUserId(userId, workspaceId, {
      includeTotpSecret: true,
    });

    if (!mfa?.totpSecret || mfa.enabledAt) {
      throw new BadRequestException('MFA setup has not been started');
    }

    return mfa;
  }

  private async assertMfaRequired() {
    if (!(await this.instanceSettingRepo.isLocalMfaRequired())) {
      throw new BadRequestException('Native MFA is disabled');
    }
  }

  private async getEnabledMfa(userId: string, workspaceId: string) {
    const mfa = await this.userMfaRepo.findByUserId(userId, workspaceId);

    if (!mfa?.enabledAt) {
      throw new BadRequestException('MFA is not enabled');
    }

    return mfa;
  }

  private async verifyCurrentPassword(
    userId: string,
    workspaceId: string,
    currentPassword: string,
  ) {
    const user = await this.getLocalPasswordUser(userId, workspaceId);
    const passwordMatches = await comparePasswordHash(
      currentPassword,
      user.password,
    );

    if (!passwordMatches) {
      throw new BadRequestException('Current password is incorrect');
    }
  }

  private async getLocalPasswordUser(userId: string, workspaceId: string) {
    const user = await this.userRepo.findById(userId, workspaceId, {
      includePassword: true,
    });

    if (!user || isUserDisabled(user)) {
      throw new NotFoundException('User not found');
    }

    if (!user.password) {
      throw new BadRequestException(
        'MFA is only available for local password accounts',
      );
    }

    return user;
  }
}
