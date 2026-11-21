import { Module } from '@nestjs/common';
import { AgentTokenModule } from '../agent-tokens/agent-token.module';
import { AgentTokenController } from '../agent-tokens/agent-token.controller';
import { PageModule } from '../page/page.module';
import { SearchModule } from '../search/search.module';
import { CommentModule } from '../comment/comment.module';
import { CollaborationModule } from '../../collaboration/collaboration.module';
import { AgentOperationsService } from './agent-operations.service';
import { AgentApiController, McpController } from './mcp.controller';

@Module({
  imports: [
    AgentTokenModule,
    PageModule,
    SearchModule,
    CommentModule,
    CollaborationModule,
  ],
  controllers: [AgentTokenController, McpController, AgentApiController],
  providers: [AgentOperationsService],
})
export class McpModule {}
