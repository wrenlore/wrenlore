import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { LoginDto } from '../dto/login.dto';
import { CreateUserDto } from '../dto/create-user.dto';
import { TokenService } from './token.service';
import { SignupService } from './signup.service';
import { CreateAdminUserDto } from '../dto/create-admin-user.dto';
import { UserRepo } from '@wrenlore/db/repos/user/user.repo';
import {
  comparePasswordHash,
  hashPassword,
  isUserDisabled,
  nanoIdGen,
} from '../../../common/helpers';
import { throwIfEmailNotVerified } from '../auth.util';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { MailService } from '../../../integrations/mail/mail.service';
import ChangePasswordEmail from '@wrenlore/transactional/emails/change-password-email';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import ForgotPasswordEmail from '@wrenlore/transactional/emails/forgot-password-email';
import { UserTokenRepo } from '@wrenlore/db/repos/user-token/user-token.repo';
import { PasswordResetDto } from '../dto/password-reset.dto';
import { User, UserToken, Workspace } from '@wrenlore/db/types/entity.types';
import { UserTokenType } from '../auth.constants';
import { KyselyDB } from '@wrenlore/db/types/kysely.types';
import { InjectKysely } from 'nestjs-kysely';
import { executeTx } from '@wrenlore/db/utils';
import { VerifyUserTokenDto } from '../dto/verify-user-token.dto';
import { DomainService } from '../../../integrations/environment/domain.service';
import { AuditEvent, AuditResource } from '../../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../../integrations/audit/audit.service';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { UserMfaRepo } from '@wrenlore/db/repos/user/user-mfa.repo';
import { JwtType } from '../dto/jwt-payload';
import { MfaService } from './mfa.service';

@Injectable()
export class AuthService {
  constructor(
    private signupService: SignupService,
    private tokenService: TokenService,
    private userRepo: UserRepo,
    private userTokenRepo: UserTokenRepo,
    private mailService: MailService,
    private domainService: DomainService,
    private environmentService: EnvironmentService,
    private userMfaRepo: UserMfaRepo,
    private mfaService: MfaService,
    @InjectKysely() private readonly db: KyselyDB,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  async login(loginDto: LoginDto, workspaceId: string) {
    const user = await this.userRepo.findByEmail(loginDto.email, workspaceId, {
      includePassword: true,
      includeUserMfa: true,
    });

    const errorMessage = 'Email or password does not match';
    if (!user || isUserDisabled(user)) {
      throw new UnauthorizedException(errorMessage);
    }

    const isPasswordMatch = await comparePasswordHash(
      loginDto.password,
      user.password,
    );

    if (!isPasswordMatch) {
      throw new UnauthorizedException(errorMessage);
    }

    throwIfEmailNotVerified({
      isCloud: this.environmentService.isCloud(),
      emailVerifiedAt: user.emailVerifiedAt,
      email: user.email,
      workspaceId,
      appSecret: this.environmentService.getAppSecret(),
    });

    if (user.mfa?.enabledAt) {
      return {
        userHasMfa: true,
        mfaToken: await this.tokenService.generateMfaToken(user, workspaceId),
      };
    }

    return this.completeLogin(user, workspaceId, 'password');
  }

  async completeMfaLogin(
    mfaToken: string,
    token: string,
  ): Promise<{ authToken: string }> {
    const user = await this.getUserFromMfaToken(mfaToken, {
      includePassword: false,
    });
    const mfa = await this.getEnabledMfaForLogin(user.id, user.workspaceId, {
      includeTotpSecret: true,
    });
    const secret = this.mfaService.decryptTotpSecret(mfa.totpSecret);

    if (!this.mfaService.verifyTotpToken(secret, token)) {
      this.logMfaChallengeFailed(user.id, 'totp');
      throw new UnauthorizedException('Invalid MFA token');
    }

    this.auditService.setActorId(user.id);
    this.auditService.log({
      event: AuditEvent.USER_MFA_CHALLENGE_SUCCEEDED,
      resourceType: AuditResource.USER,
      resourceId: user.id,
      metadata: { method: 'totp' },
    });

    const authToken = await this.completeLogin(user, user.workspaceId, 'mfa');
    return { authToken };
  }

  async completeMfaRecoveryLogin(
    mfaToken: string,
    recoveryCode: string,
  ): Promise<{ authToken: string }> {
    const user = await this.getUserFromMfaToken(mfaToken, {
      includePassword: false,
    });
    const mfa = await this.getEnabledMfaForLogin(user.id, user.workspaceId);
    const recoveryCodes = await this.userMfaRepo.findRecoveryCodesByMfaId(
      mfa.id,
    );
    const matchingCode = await this.mfaService.findMatchingRecoveryCode(
      recoveryCode,
      recoveryCodes,
    );

    if (!matchingCode) {
      this.logMfaChallengeFailed(user.id, 'recovery_code');
      throw new UnauthorizedException('Invalid recovery code');
    }

    const consumedCode = await this.userMfaRepo.markRecoveryCodeUsed(
      matchingCode.id,
    );

    if (!consumedCode) {
      this.logMfaChallengeFailed(user.id, 'recovery_code');
      throw new UnauthorizedException('Invalid recovery code');
    }

    this.auditService.setActorId(user.id);
    this.auditService.log({
      event: AuditEvent.USER_MFA_RECOVERY_CODE_USED,
      resourceType: AuditResource.USER,
      resourceId: user.id,
      metadata: { recoveryCodeId: matchingCode.id },
    });
    this.auditService.log({
      event: AuditEvent.USER_MFA_CHALLENGE_SUCCEEDED,
      resourceType: AuditResource.USER,
      resourceId: user.id,
      metadata: { method: 'recovery_code' },
    });

    const authToken = await this.completeLogin(
      user,
      user.workspaceId,
      'mfa_recovery_code',
    );
    return { authToken };
  }

  private async completeLogin(
    user: User,
    workspaceId: string,
    source: string,
  ): Promise<string> {
    user.lastLoginAt = new Date();
    await this.userRepo.updateLastLogin(user.id, workspaceId);

    this.auditService.log({
      event: AuditEvent.USER_LOGIN,
      resourceType: AuditResource.USER,
      resourceId: user.id,
      metadata: { source },
    });

    return this.tokenService.generateAccessToken(user);
  }

  private async getUserFromMfaToken(
    mfaToken: string,
    opts?: { includePassword?: boolean },
  ) {
    const payload = await this.tokenService.verifyJwt(
      mfaToken,
      JwtType.MFA_TOKEN,
    );
    const user = await this.userRepo.findById(payload.sub, payload.workspaceId, {
      includePassword: opts?.includePassword,
    });

    if (!user || isUserDisabled(user)) {
      throw new UnauthorizedException('Invalid MFA challenge');
    }

    return user;
  }

  private async getEnabledMfaForLogin(
    userId: string,
    workspaceId: string,
    opts?: { includeTotpSecret?: boolean },
  ) {
    const mfa = await this.userMfaRepo.findByUserId(userId, workspaceId, opts);

    if (!mfa?.enabledAt) {
      throw new UnauthorizedException('MFA is not enabled');
    }

    if (opts?.includeTotpSecret && !mfa.totpSecret) {
      throw new UnauthorizedException('MFA is not configured');
    }

    return mfa;
  }

  private logMfaChallengeFailed(userId: string, method: string) {
    this.auditService.setActorId(userId);
    this.auditService.log({
      event: AuditEvent.USER_MFA_CHALLENGE_FAILED,
      resourceType: AuditResource.USER,
      resourceId: userId,
      metadata: { method },
    });
  }

  async register(createUserDto: CreateUserDto, workspaceId: string) {
    const user = await this.signupService.signup(createUserDto, workspaceId);
    return this.tokenService.generateAccessToken(user);
  }

  async setup(createAdminUserDto: CreateAdminUserDto) {
    const { workspace, user } =
      await this.signupService.initialSetup(createAdminUserDto);

    const authToken = await this.tokenService.generateAccessToken(user);
    return { workspace, authToken };
  }

  async changePassword(
    dto: ChangePasswordDto,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    const user = await this.userRepo.findById(userId, workspaceId, {
      includePassword: true,
    });

    if (!user || isUserDisabled(user)) {
      throw new NotFoundException('User not found');
    }

    const comparePasswords = await comparePasswordHash(
      dto.oldPassword,
      user.password,
    );

    if (!comparePasswords) {
      throw new BadRequestException('Current password is incorrect');
    }

    const newPasswordHash = await hashPassword(dto.newPassword);
    await this.userRepo.updateUser(
      {
        password: newPasswordHash,
        hasGeneratedPassword: false,
      },
      userId,
      workspaceId,
    );

    this.auditService.log({
      event: AuditEvent.USER_PASSWORD_CHANGED,
      resourceType: AuditResource.USER,
      resourceId: userId,
    });

    const emailTemplate = ChangePasswordEmail({ username: user.name });
    await this.mailService.sendToQueue({
      to: user.email,
      subject: 'Your password has been changed',
      template: emailTemplate,
    });
  }

  async forgotPassword(
    forgotPasswordDto: ForgotPasswordDto,
    workspace: Workspace,
  ): Promise<void> {
    const user = await this.userRepo.findByEmail(
      forgotPasswordDto.email,
      workspace.id,
    );

    if (!user || isUserDisabled(user)) {
      return;
    }

    const token = nanoIdGen(16);

    await executeTx(this.db, async (trx) => {
      await trx
        .deleteFrom('userTokens')
        .where('userId', '=', user.id)
        .where('type', '=', UserTokenType.FORGOT_PASSWORD)
        .execute();

      await this.userTokenRepo.insertUserToken(
        {
          token,
          userId: user.id,
          workspaceId: user.workspaceId,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
          type: UserTokenType.FORGOT_PASSWORD,
        },
        { trx },
      );
    });

    const resetLink = `${this.domainService.getUrl(workspace.hostname)}/password-reset?token=${token}`;

    const emailTemplate = ForgotPasswordEmail({
      username: user.name,
      resetLink: resetLink,
    });

    await this.mailService.sendToQueue({
      to: user.email,
      subject: 'Reset your password',
      template: emailTemplate,
    });
  }

  async passwordReset(
    passwordResetDto: PasswordResetDto,
    workspace: Workspace,
  ) {
    const userToken = await this.userTokenRepo.findById(
      passwordResetDto.token,
      workspace.id,
    );

    if (
      !userToken ||
      userToken.type !== UserTokenType.FORGOT_PASSWORD ||
      userToken.expiresAt < new Date()
    ) {
      throw new BadRequestException('Invalid or expired token');
    }

    const user = await this.userRepo.findById(userToken.userId, workspace.id);
    if (!user || isUserDisabled(user)) {
      throw new NotFoundException('User not found');
    }

    const newPasswordHash = await hashPassword(passwordResetDto.newPassword);

    await executeTx(this.db, async (trx) => {
      await this.userRepo.updateUser(
        {
          password: newPasswordHash,
          hasGeneratedPassword: false,
        },
        user.id,
        workspace.id,
        trx,
      );

      await trx
        .deleteFrom('userTokens')
        .where('userId', '=', user.id)
        .where('type', '=', UserTokenType.FORGOT_PASSWORD)
        .execute();
    });

    this.auditService.setActorId(user.id);
    this.auditService.log({
      event: AuditEvent.USER_PASSWORD_RESET,
      resourceType: AuditResource.USER,
      resourceId: user.id,
    });

    const emailTemplate = ChangePasswordEmail({ username: user.name });
    await this.mailService.sendToQueue({
      to: user.email,
      subject: 'Your password has been changed',
      template: emailTemplate,
    });

    if (this.environmentService.isCloud() && !user.emailVerifiedAt) {
      await this.userRepo.updateUser(
        { emailVerifiedAt: new Date() },
        user.id,
        workspace.id,
      );
    }

    const authToken = await this.tokenService.generateAccessToken(user);
    return { authToken };
  }

  async verifyUserToken(
    userTokenDto: VerifyUserTokenDto,
    workspaceId: string,
  ): Promise<void> {
    const userToken: UserToken = await this.userTokenRepo.findById(
      userTokenDto.token,
      workspaceId,
    );

    if (
      !userToken ||
      userToken.type !== userTokenDto.type ||
      userToken.expiresAt < new Date()
    ) {
      throw new BadRequestException('Invalid or expired token');
    }
  }

  async getCollabToken(user: User, workspaceId: string) {
    const token = await this.tokenService.generateCollabToken(
      user,
      workspaceId,
    );
    return { token };
  }
}
