import { Logger, OnModuleDestroy } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import { IPageHistoryJob } from '../../integrations/queue/constants/queue.interface';
import { PageHistoryRepo } from '@wrenlore/db/repos/page/page-history.repo';
import { PageRepo } from '@wrenlore/db/repos/page/page.repo';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@wrenlore/db/types/kysely.types';
import { CollabHistoryService } from '../services/collab-history.service';

@Processor(QueueName.HISTORY_QUEUE)
export class HistoryProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(HistoryProcessor.name);

  constructor(
    private readonly pageHistoryRepo: PageHistoryRepo,
    private readonly pageRepo: PageRepo,
    private readonly collabHistory: CollabHistoryService,
    @InjectKysely() private readonly db: KyselyDB,
  ) {
    super();
  }

  async process(job: Job<IPageHistoryJob, void>): Promise<void> {
    if (job.name !== QueueJob.PAGE_HISTORY) return;

    // Drain jobs created by older deployments into the durable database queue.
    const { pageId } = job.data;
    const contributorIds = await this.collabHistory.popContributors(pageId);
    try {
      await this.db.transaction().execute(async (trx) => {
        const page = await this.pageRepo.findById(pageId, {
          withLock: true,
          trx,
        });
        if (page)
          await this.pageHistoryRepo.scheduleHistory(
            page,
            contributorIds,
            trx,
            0,
          );
      });
    } catch (error) {
      await this.collabHistory.addContributors(pageId, contributorIds);
      throw error;
    }
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.debug(`Processing ${job.name} for page: ${job.data.pageId}`);
  }

  @OnWorkerEvent('failed')
  onError(job: Job) {
    this.logger.error(
      `Failed ${job.name} for page: ${job.data.pageId}. Reason: ${job.failedReason}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }
}
