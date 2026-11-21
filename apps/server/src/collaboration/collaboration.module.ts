import {
  Global,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AuthenticationExtension } from './extensions/authentication.extension';
import { PersistenceExtension } from './extensions/persistence.extension';
import { CollaborationGateway } from './collaboration.gateway';
import { HttpAdapterHost } from '@nestjs/core';
import { CollabWsAdapter } from './adapter/collab-ws.adapter';
import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { TokenModule } from '../core/auth/token.module';
import { HistoryProcessor } from './processors/history.processor';
import { LoggerExtension } from './extensions/logger.extension';
import { CollaborationHandler } from './collaboration.handler';
import { CollabHistoryService } from './services/collab-history.service';
import { WatcherModule } from '../core/watcher/watcher.module';
import { AgentTokenModule } from '../core/agent-tokens/agent-token.module';
import { AgentDocumentService } from './agent-document.service';
import { DocumentWriteQueue } from './document-write-queue';

@Module({
  providers: [
    CollaborationGateway,
    AuthenticationExtension,
    PersistenceExtension,
    LoggerExtension,
    HistoryProcessor,
    CollabHistoryService,
    CollaborationHandler,
    AgentDocumentService,
    DocumentWriteQueue,
  ],
  exports: [CollaborationGateway],
  imports: [TokenModule, WatcherModule, AgentTokenModule],
})
export class CollaborationModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CollaborationModule.name);
  private collabWsAdapter: CollabWsAdapter;
  private path = '/collab';

  constructor(
    private readonly collaborationGateway: CollaborationGateway,
    private readonly httpAdapterHost: HttpAdapterHost,
  ) {}

  onModuleInit() {
    this.collabWsAdapter = new CollabWsAdapter();
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer();

    const wss = this.collabWsAdapter.handleUpgrade(this.path, httpServer);

    wss.on('connection', (client: WebSocket, request: IncomingMessage) => {
      this.collaborationGateway.handleConnection(client, request);

      client.on('error', (error) => {
        this.logger.error('WebSocket client error:', error);
      });
    });

    wss.on('error', (error) =>
      this.logger.error('WebSocket server error:', error),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.collaborationGateway?.destroy(this.collabWsAdapter);
    this.collabWsAdapter?.destroy();
  }
}
