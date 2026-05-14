import {
  Body,
  Controller,
  Get,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User, Workspace } from '@wrenlore/db/types/entity.types';
import WorkspaceAbilityFactory from '../casl/abilities/workspace-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../casl/interfaces/workspace-ability.type';
import { FastifyReply } from 'fastify';
import { SamlAuthGuard } from './saml-auth.guard';
import { SsoService } from './sso.service';
import { CreateSsoProviderDto } from './dto/create-sso-provider.dto';
import { UpdateSsoProviderDto } from './dto/update-sso-provider.dto';
import { ProviderIdDto } from './dto/provider-id.dto';

@UseGuards(JwtAuthGuard)
@Controller('sso')
export class SsoController {
  constructor(
    private readonly ssoService: SsoService,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('providers')
  async listProviders(
    @AuthWorkspace() workspace: Workspace,
    @AuthUser() user: User,
  ) {
    this.assertManageSettings(user, workspace);
    return this.ssoService.listProviders(workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('info')
  async getProvider(
    @AuthWorkspace() workspace: Workspace,
    @AuthUser() user: User,
    @Body() dto: ProviderIdDto,
  ) {
    this.assertManageSettings(user, workspace);
    return this.ssoService.getProvider(workspace.id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('create')
  async createProvider(
    @AuthWorkspace() workspace: Workspace,
    @AuthUser() user: User,
    @Body() dto: CreateSsoProviderDto,
  ) {
    this.assertManageSettings(user, workspace);
    return this.ssoService.createProvider(workspace.id, user.id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async updateProvider(
    @AuthWorkspace() workspace: Workspace,
    @AuthUser() user: User,
    @Body() dto: UpdateSsoProviderDto,
  ) {
    this.assertManageSettings(user, workspace);
    return this.ssoService.updateProvider(workspace.id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('delete')
  async deleteProvider(
    @AuthWorkspace() workspace: Workspace,
    @AuthUser() user: User,
    @Body() dto: ProviderIdDto,
  ) {
    this.assertManageSettings(user, workspace);
    await this.ssoService.deleteProvider(workspace.id, dto);
  }

  @Public()
  @UseGuards(SamlAuthGuard)
  @Get('saml/:providerId/login')
  async samlLogin() {
    return;
  }

  @Public()
  @UseGuards(SamlAuthGuard)
  @Post('saml/:providerId/callback')
  async samlCallback(
    @Req() req: any,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const user: User = req.user;
    const token = await this.ssoService.issueAuthCookieAndToken(user);
    this.ssoService.setAuthCookie(res, token);

    const redirectUrl = await this.ssoService.buildPostLoginRedirect(
      user,
      req.body?.RelayState ?? req.query?.RelayState,
    );

    return res.redirect(redirectUrl);
  }

  private assertManageSettings(user: User, workspace: Workspace) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Settings)
    ) {
      throw new ForbiddenException();
    }
  }
}
