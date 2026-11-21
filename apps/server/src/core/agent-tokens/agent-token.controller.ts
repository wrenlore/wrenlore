import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@wrenlore/db/types/entity.types';
import { AgentTokenService } from './agent-token.service';

@Controller('agent-tokens')
@UseGuards(JwtAuthGuard)
export class AgentTokenController {
  constructor(private readonly tokens: AgentTokenService) {}
  @Get()
  list(@AuthUser() user: User) {
    return this.tokens.list(user);
  }
  @Post()
  create(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() input: unknown,
  ) {
    return this.tokens.create(user, workspace, input);
  }
  @Post(':id/revoke')
  revoke(@AuthUser() user: User, @Param('id') id: string) {
    return this.tokens.revoke(user, id);
  }
}
