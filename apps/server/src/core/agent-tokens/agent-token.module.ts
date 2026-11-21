import { Module } from '@nestjs/common';
import { AgentTokenService } from './agent-token.service';
import { CaslModule } from '../casl/casl.module';
import { PageAccessModule } from '../page/page-access/page-access.module';

@Module({
  imports: [CaslModule, PageAccessModule],
  providers: [AgentTokenService],
  exports: [AgentTokenService],
})
export class AgentTokenModule {}
