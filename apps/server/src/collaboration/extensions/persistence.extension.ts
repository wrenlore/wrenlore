import {
  afterUnloadDocumentPayload,
  Extension,
  onChangePayload,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
} from '@hocuspocus/server';
import * as Y from 'yjs';
import { Injectable, Logger } from '@nestjs/common';
import { TiptapTransformer } from '@hocuspocus/transformer';
import { getPageId, jsonToText, tiptapExtensions } from '../collaboration.util';
import { PageRepo } from '@wrenlore/db/repos/page/page.repo';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@wrenlore/db/types/kysely.types';
import { executeTx } from '@wrenlore/db/utils';
import { InjectQueue } from '@nestjs/bullmq';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import { Queue } from 'bullmq';
import {
  extractMentions,
  extractPageMentions,
  extractUserMentions,
} from '../../common/helpers/prosemirror/utils';
import { isDeepStrictEqual } from 'node:util';
import {
  IPageBacklinkJob,
  IPageMentionNotificationJob,
} from '../../integrations/queue/constants/queue.interface';
import { Page } from '@wrenlore/db/types/entity.types';
import { DocumentWriteQueue } from '../document-write-queue';
import { PageHistoryRepo } from '@wrenlore/db/repos/page/page-history.repo';

@Injectable()
export class PersistenceExtension implements Extension {
  private readonly logger = new Logger(PersistenceExtension.name);
  private contributors: Map<string, Set<string>> = new Map();

  constructor(
    private readonly pageRepo: PageRepo,
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.GENERAL_QUEUE) private generalQueue: Queue,
    @InjectQueue(QueueName.AI_QUEUE) private aiQueue: Queue,
    private readonly pageHistoryRepo: PageHistoryRepo,
    @InjectQueue(QueueName.NOTIFICATION_QUEUE) private notificationQueue: Queue,
    private readonly documentWrites: DocumentWriteQueue,
  ) {}

  async onLoadDocument(data: onLoadDocumentPayload) {
    const { documentName, document } = data;
    const pageId = getPageId(documentName);

    if (!document.isEmpty('default')) {
      return;
    }

    const page = await this.pageRepo.findById(pageId, {
      includeContent: true,
      includeYdoc: true,
    });

    if (!page) {
      this.logger.warn('page not found');
      return;
    }

    if (page.ydoc) {
      this.logger.debug(`ydoc loaded from db: ${pageId}`);

      const doc = new Y.Doc();
      const dbState = new Uint8Array(page.ydoc);

      Y.applyUpdate(doc, dbState);
      return doc;
    }

    // if no ydoc state in db convert json in page.content to Ydoc.
    if (page.content) {
      this.logger.debug(`converting json to ydoc: ${pageId}`);

      const ydoc = TiptapTransformer.toYdoc(
        page.content,
        'default',
        tiptapExtensions,
      );

      Y.encodeStateAsUpdate(ydoc);
      return ydoc;
    }

    this.logger.debug(`creating fresh ydoc: ${pageId}`);
    return new Y.Doc();
  }

  async onStoreDocument(data: onStoreDocumentPayload) {
    return this.documentWrites.run(data.documentName, () =>
      this.storeDocument(data),
    );
  }

  private async storeDocument(data: onStoreDocumentPayload) {
    const { documentName, document, context } = data;

    const pageId = getPageId(documentName);

    const tiptapJson = TiptapTransformer.fromYdoc(document, 'default');
    const ydocState = Buffer.from(Y.encodeStateAsUpdate(document));

    let textContent = null;

    try {
      textContent = jsonToText(tiptapJson);
    } catch (err) {
      this.logger.warn('jsonToText' + err?.['message']);
    }

    let page: Page = null;
    const editingUserIds = this.consumeContributors(documentName);

    try {
      await executeTx(this.db, async (trx) => {
        page = await this.pageRepo.findById(pageId, {
          withLock: true,
          includeContent: true,
          trx,
        });

        if (!page) {
          this.logger.error(`Page with id ${pageId} not found`);
          return;
        }

        if (isDeepStrictEqual(tiptapJson, page.content)) {
          page = null;
          return;
        }

        let contributorIds = undefined;
        try {
          const existingContributors = page.contributorIds || [];
          contributorIds = Array.from(
            new Set([
              ...existingContributors,
              ...editingUserIds,
              page.creatorId,
            ]),
          );
        } catch (err) {
          //this.logger.debug('Contributors error:' + err?.['message']);
        }

        await this.pageRepo.updatePage(
          {
            content: tiptapJson,
            textContent: textContent,
            ydoc: ydocState,
            // A direct read connection can flush an existing browser edit.
            // Attribute that edit to its writer, not the reader that flushed it.
            lastUpdatedById:
              editingUserIds[editingUserIds.length - 1] ?? context.user.id,
            contributorIds: contributorIds,
          },
          pageId,
          trx,
        );

        await this.pageHistoryRepo.scheduleHistory(page, editingUserIds, trx);

        this.logger.debug(`Page updated: ${pageId} - SlugId: ${page.slugId}`);
      });
    } catch (err) {
      const pending = this.contributors.get(documentName) ?? new Set<string>();
      editingUserIds.forEach((id) => pending.add(id));
      this.contributors.set(documentName, pending);
      this.logger.error(`Failed to update page ${pageId}`, err);
      throw err;
    }

    if (page) {
      await this.afterContentSave(page, tiptapJson);
    }
  }

  async afterAgentSave(previousPage: Page, content: any, userId: string) {
    await this.afterContentSave(previousPage, content);
  }

  private async afterContentSave(page: Page, tiptapJson: any) {
    const pageId = page.id;

    const mentions = extractMentions(tiptapJson);
    const pageMentions = extractPageMentions(mentions);

    await this.generalQueue.add(QueueJob.PAGE_BACKLINKS, {
      pageId: pageId,
      workspaceId: page.workspaceId,
      mentions: pageMentions,
    } as IPageBacklinkJob);

    const userMentions = extractUserMentions(mentions);
    const oldMentions = page.content ? extractMentions(page.content) : [];
    const oldMentionedUserIds = extractUserMentions(oldMentions).map(
      (m) => m.entityId,
    );

    if (userMentions.length > 0) {
      await this.notificationQueue.add(QueueJob.PAGE_MENTION_NOTIFICATION, {
        userMentions: userMentions.map((m) => ({
          userId: m.entityId,
          mentionId: m.id,
          creatorId: m.creatorId,
        })),
        oldMentionedUserIds,
        pageId,
        spaceId: page.spaceId,
        workspaceId: page.workspaceId,
      } as IPageMentionNotificationJob);
    }

    await this.aiQueue.add(QueueJob.PAGE_CONTENT_UPDATED, {
      pageIds: [pageId],
      workspaceId: page.workspaceId,
    });
  }

  async onChange(data: onChangePayload) {
    const documentName = data.documentName;
    const userId = data.context?.user?.id;

    if (!userId) return;

    if (!this.contributors.has(documentName)) {
      this.contributors.set(documentName, new Set());
    }

    this.contributors.get(documentName).add(userId);
  }

  async afterUnloadDocument(data: afterUnloadDocumentPayload) {
    const documentName = data.documentName;
    this.contributors.delete(documentName);
  }

  private consumeContributors(documentName: string): string[] {
    const contributorSet = this.contributors.get(documentName);
    if (!contributorSet) return [];
    const userIds = [...contributorSet];
    this.contributors.delete(documentName);
    return userIds;
  }
}
