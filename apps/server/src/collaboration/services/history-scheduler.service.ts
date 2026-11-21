import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PageHistoryRepo } from '@wrenlore/db/repos/page/page-history.repo';
import { WatcherService } from '../../core/watcher/watcher.service';

/** The database is the queue. Restarting the app or losing Redis cannot lose work. */
@Injectable()
export class HistoryScheduler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(HistoryScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;

  constructor(
    private readonly histories: PageHistoryRepo,
    private readonly watchers: WatcherService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => {
      void this.drain();
    }, 5000);
    this.timer.unref();
  }

  drain(): Promise<void> {
    if (!this.running) {
      this.running = this.processBatch()
        .catch((error) => {
          this.logger.error(`History scheduling failed: ${errorKind(error)}`);
        })
        .finally(() => {
          this.running = undefined;
        });
    }
    return this.running;
  }

  private async processBatch() {
    for (const { pageId } of await this.histories.findDueHistory()) {
      let result: Awaited<ReturnType<PageHistoryRepo['savePendingHistory']>>;
      try {
        result = await this.histories.savePendingHistory(pageId);
      } catch (error) {
        // Retain the job indefinitely, with bounded backoff and diagnostic metadata.
        await this.histories.deferHistoryRetry(pageId, errorKind(error));
        this.logger.error(
          `History snapshot failed for ${pageId}: ${errorKind(error)}`,
        );
        continue;
      }
      if (!result) continue;
      // A watcher failure must never roll back or prevent a history snapshot.
      try {
        await this.watchers.addPageWatchers(
          result.contributorIds,
          pageId,
          result.spaceId,
          result.workspaceId,
        );
      } catch (error) {
        this.logger.warn(
          `History saved; watcher update failed for ${pageId}: ${errorKind(error)}`,
        );
      }
    }
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}

function errorKind(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
  )
    return error.code;
  return error instanceof Error ? error.name : 'UnknownError';
}
