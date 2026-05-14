import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { AuthService } from './services/auth.service';
import { SetupGuard } from './guards/setup.guard';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User, Workspace } from '@wrenlore/db/types/entity.types';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { PasswordResetDto } from './dto/password-reset.dto';
import { VerifyUserTokenDto } from './dto/verify-user-token.dto';
import { FastifyReply } from 'fastify';
import { validateSsoEnforcement } from './auth.util';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { MfaManagementService } from './services/mfa-management.service';
import {
  ConfirmMfaSetupDto,
  CompleteMfaLoginDto,
  CompleteMfaRecoveryLoginDto,
  DisableMfaDto,
  RegenerateMfaRecoveryCodesDto,
} from './dto/mfa.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private mfaManagementService: MfaManagementService,
    private environmentService: EnvironmentService,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() loginInput: LoginDto,
  ) {
    validateSsoEnforcement(workspace);

    const result = await this.authService.login(loginInput, workspace.id);

    if (typeof result === 'string') {
      this.setAuthCookie(res, result);
      return;
    }

    if (result.authToken) {
      this.setAuthCookie(res, result.authToken);
      const { authToken, ...response } = result;
      return response;
    }

    return result;
  }

  @UseGuards(SetupGuard)
  @HttpCode(HttpStatus.OK)
  @Post('setup')
  async setupWorkspace(
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() createAdminUserDto: CreateAdminUserDto,
  ) {
    const { workspace, authToken } =
      await this.authService.setup(createAdminUserDto);

    this.setAuthCookie(res, authToken);
    return workspace;
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.authService.changePassword(dto, user.id, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  async forgotPassword(
    @Body() forgotPasswordDto: ForgotPasswordDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    validateSsoEnforcement(workspace);
    return this.authService.forgotPassword(forgotPasswordDto, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @Post('password-reset')
  async passwordReset(
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() passwordResetDto: PasswordResetDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const result = await this.authService.passwordReset(
      passwordResetDto,
      workspace,
    );

    this.setAuthCookie(res, result.authToken);
    return {
      requiresLogin: false,
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('verify-token')
  async verifyResetToken(
    @Body() verifyUserTokenDto: VerifyUserTokenDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.authService.verifyUserToken(verifyUserTokenDto, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('mfa/challenge/totp')
  async completeMfaLogin(
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() dto: CompleteMfaLoginDto,
  ) {
    const result = await this.authService.completeMfaLogin(
      dto.mfaToken,
      dto.token,
    );
    this.setAuthCookie(res, result.authToken);
  }

  @HttpCode(HttpStatus.OK)
  @Post('mfa/challenge/recovery-code')
  async completeMfaRecoveryLogin(
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() dto: CompleteMfaRecoveryLoginDto,
  ) {
    const result = await this.authService.completeMfaRecoveryLogin(
      dto.mfaToken,
      dto.recoveryCode,
    );
    this.setAuthCookie(res, result.authToken);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('mfa/setup/start')
  async startMfaSetup(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.mfaManagementService.startSetup(user.id, workspace.id);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('mfa/setup/confirm')
  async confirmMfaSetup(
    @Body() dto: ConfirmMfaSetupDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.mfaManagementService.confirmSetup(
      user.id,
      workspace.id,
      dto.token,
    );
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('mfa/disable')
  async disableMfa(
    @Body() dto: DisableMfaDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.mfaManagementService.disable(
      user.id,
      workspace.id,
      dto.currentPassword,
    );
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('mfa/recovery-codes/regenerate')
  async regenerateMfaRecoveryCodes(
    @Body() dto: RegenerateMfaRecoveryCodesDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.mfaManagementService.regenerateRecoveryCodes(
      user.id,
      workspace.id,
      dto.currentPassword,
    );
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('collab-token')
  async collabToken(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.authService.getCollabToken(user, workspace.id);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(
    @AuthUser() user: User,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    res.clearCookie('authToken');

    this.auditService.log({
      event: AuditEvent.USER_LOGOUT,
      resourceType: AuditResource.USER,
      resourceId: user.id,
    });
  }

  setAuthCookie(res: FastifyReply, token: string) {
    res.setCookie('authToken', token, {
      httpOnly: true,
      path: '/',
      expires: this.environmentService.getCookieExpiresIn(),
      secure: this.environmentService.isHttps(),
    });
  }
}
