import { Module } from '@nestjs/common';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';
import { SamlAuthGuard } from './saml-auth.guard';
import { WorkspaceModule } from '../workspace/workspace.module';
import { TokenModule } from '../auth/token.module';

@Module({
  imports: [WorkspaceModule, TokenModule],
  controllers: [SsoController],
  providers: [SsoService, SamlAuthGuard],
})
export class SsoModule {}
