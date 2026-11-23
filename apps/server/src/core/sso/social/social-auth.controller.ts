import {
  Body,
  Controller,
  BadRequestException,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { Public } from '../../../common/decorators/public.decorator';
import { SkipTransform } from '../../../common/decorators/skip-transform.decorator';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { User, Workspace } from '@wrenlore/db/types/entity.types';
import { extractBearerTokenFromHeader } from '../../../common/helpers';
import { TokenService } from '../../auth/services/token.service';
import { SocialAuthService, SocialAuthFlowError, SocialCallbackResult } from './social-auth.service';
import {
  isSocialProviderType,
  SOCIAL_LINK_RECENT_AUTH_TTL_S,
  SocialProviderType,
} from './social.constants';
import { StartSocialLinkDto } from './dto/start-social-link.dto';
import { UnlinkSocialAccountDto } from './dto/unlink-social-account.dto';

const SOCIAL_LINK_ERROR_MESSAGES: Record<string, string> = {
  provider_disabled: 'This login provider is not enabled.',
  provider_not_configured: 'This login provider is not fully configured.',
  sso_enforced: 'This workspace enforces enterprise single sign-on.',
};

@Controller('auth/social')
export class SocialAuthController {
  constructor(
    private readonly socialAuthService: SocialAuthService,
    private readonly tokenService: TokenService,
  ) {}

  @Public()
  @SkipTransform()
  @Get(':provider/start')
  async startLogin(
    @Param('provider') provider: string,
    @AuthWorkspace() workspace: Workspace,
    @Query('redirect') redirect: string | undefined,
    @Res() res: FastifyReply,
  ) {
    const type = this.parseProvider(provider);
    try {
      const authorizeUrl = await this.socialAuthService.startLogin(
        workspace,
        type,
        redirect,
      );
      return res
        .status(HttpStatus.FOUND)
        .header('Location', authorizeUrl)
        .send();
    } catch (error) {
      return this.redirectWithError(res, workspace, error);
    }
  }

  @Public()
  @SkipTransform()
  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @AuthWorkspace() workspace: Workspace,
    @Query() query: Record<string, string | undefined>,
    @Res() res: FastifyReply,
  ) {
    const type = this.parseProvider(provider);
    try {
      const result = await this.socialAuthService.handleCallback({
        workspace,
        type,
        query,
      });
      return this.sendCallbackResult(res, workspace, result);
    } catch (error) {
      return this.redirectWithError(res, workspace, error);
    }
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('link/start')
  async startLink(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: any,
    @Body() dto: StartSocialLinkDto,
  ) {
    const type = this.parseProvider(dto.providerType);

    const token = req.cookies?.authToken || extractBearerTokenFromHeader(req);
    if (
      !token ||
      !this.tokenService.isRecentlyAuthenticated(
        token,
        SOCIAL_LINK_RECENT_AUTH_TTL_S,
      )
    ) {
      throw new ForbiddenException(
        'Please sign in again to connect an account.',
      );
    }

    const url = await this.handleLinkStartErrors(() =>
      this.socialAuthService.startLink(user, workspace, type, dto.redirect),
    );
    return { url };
  }

  private async handleLinkStartErrors(
    fn: () => Promise<string>,
  ): Promise<string> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof SocialAuthFlowError) {
        throw new BadRequestException(SOCIAL_LINK_ERROR_MESSAGES[error.code] ?? 'Social login is not available.');
      }
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('accounts')
  async listAccounts(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.socialAuthService.listAccounts(user, workspace);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('unlink')
  async unlink(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() dto: UnlinkSocialAccountDto,
  ) {
    const type = this.parseProvider(dto.providerType);
    await this.socialAuthService.unlink(user, workspace, type);
  }

  private parseProvider(provider: string): SocialProviderType {
    if (!isSocialProviderType(provider)) {
      throw new NotFoundException('Unsupported social provider');
    }
    return provider;
  }

  private sendCallbackResult(
    res: FastifyReply,
    workspace: Workspace,
    result: SocialCallbackResult,
  ) {
    if (result.kind === 'session') {
      this.socialAuthService.setAuthCookie(res, result.authToken);
    }
    return res
      .status(HttpStatus.SEE_OTHER)
      .header('Location', result.redirectUrl)
      .send();
  }

  private redirectWithError(
    res: FastifyReply,
    workspace: Workspace,
    error: unknown,
  ) {
    const code =
      error instanceof SocialAuthFlowError ? error.code : 'provider_rejected';
    const url = this.socialAuthService.getLoginErrorUrl(workspace, code);
    return res.status(HttpStatus.SEE_OTHER).header('Location', url).send();
  }
}
