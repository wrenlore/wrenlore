import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '../../types/kysely.types';
import { dbOrTx } from '../../utils';
import {
  InsertablePageHistory,
  Page,
  PageHistory,
} from '@wrenlore/db/types/entity.types';
import { PaginationOptions } from '@wrenlore/db/pagination/pagination-options';
import { validate as isUuid } from 'uuid';
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres';
import { ExpressionBuilder, sql } from 'kysely';
import { historyDelay, sameHistoryState } from './history-policy';
import { DB } from '@wrenlore/db/types/db';

@Injectable()
export class PageHistoryRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  private baseFields: Array<keyof PageHistory> = [
    'agentName',
    'id',
    'pageId',
    'slugId',
    'title',
    'icon',
    'coverPhoto',
    'lastUpdatedById',
    'contributorIds',
    'spaceId',
    'workspaceId',
    'createdAt',
  ];

  async findById(
    pageHistoryId: string,
    opts?: {
      includeContent?: boolean;
      trx?: KyselyTransaction;
    },
  ): Promise<PageHistory> {
    const db = dbOrTx(this.db, opts?.trx);

    return await db
      .selectFrom('pageHistory')
      .select(this.baseFields)
      .$if(opts?.includeContent, (qb) => qb.select('content'))
      .select((eb) => this.withLastUpdatedBy(eb))
      .select((eb) => this.withContributors(eb))
      .where('id', '=', pageHistoryId)
      .executeTakeFirst();
  }

  async insertPageHistory(
    insertablePageHistory: InsertablePageHistory,
    trx?: KyselyTransaction,
  ): Promise<PageHistory> {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('pageHistory')
      .values({
        ...insertablePageHistory,
        createdAt:
          insertablePageHistory.createdAt ?? sql<Date>`clock_timestamp()`,
      })
      .returningAll()
      .executeTakeFirst();
  }

  async saveHistory(
    page: Page,
    opts?: {
      contributorIds?: string[];
      agentName?: string;
      trx?: KyselyTransaction;
    },
  ): Promise<void> {
    await this.insertPageHistory(
      {
        pageId: page.id,
        slugId: page.slugId,
        title: page.title,
        content: page.content,
        icon: page.icon,
        coverPhoto: page.coverPhoto,
        lastUpdatedById: page.lastUpdatedById ?? page.creatorId,
        contributorIds: opts?.contributorIds,
        agentName: opts?.agentName,
        spaceId: page.spaceId,
        workspaceId: page.workspaceId,
      },
      opts?.trx,
    );
  }

  async findPageHistoryByPageId(pageId: string, pagination: PaginationOptions) {
    const backwards = !!pagination.beforeCursor;
    const cursor = pagination.cursor ?? pagination.beforeCursor;
    let query = this.db
      .selectFrom('pageHistory')
      .select(this.baseFields)
      .select((eb) => this.withLastUpdatedBy(eb))
      .select((eb) => this.withContributors(eb))
      .where('pageId', '=', pageId);
    if (cursor) {
      const anchorId = new URLSearchParams(
        Buffer.from(cursor, 'base64url').toString(),
      ).get('id');
      if (!anchorId || !isUuid(anchorId))
        throw new BadRequestException('Invalid history cursor');
      // Look up the exact timestamp in SQL. A round-trip through JS Date loses
      // microseconds and can skip/repeat versions at a pagination boundary.
      const anchor = this.db
        .selectFrom('pageHistory as anchor')
        .select(['anchor.createdAt', 'anchor.id'])
        .where('anchor.id', '=', anchorId)
        .where('anchor.pageId', '=', pageId);
      query = query.where(
        backwards
          ? sql<boolean>`(page_history.created_at, page_history.id) > (${anchor})`
          : sql<boolean>`(page_history.created_at, page_history.id) < (${anchor})`,
      );
    }
    const limit = pagination.limit ?? 20;
    const rows = await query
      .orderBy('createdAt', backwards ? 'asc' : 'desc')
      .orderBy('id', backwards ? 'asc' : 'desc')
      .limit(limit + 1)
      .execute();
    const more = rows.length > limit;
    const items = rows.slice(0, limit);
    if (backwards) items.reverse();
    const encode = (id: string) =>
      Buffer.from(new URLSearchParams({ id }).toString()).toString('base64url');
    const hasNextPage = items.length > 0 && (backwards ? !!cursor : more);
    const hasPrevPage = items.length > 0 && (backwards ? more : !!cursor);
    return {
      items,
      meta: {
        limit,
        hasNextPage,
        hasPrevPage,
        nextCursor: hasNextPage ? encode(items[items.length - 1].id) : null,
        prevCursor: hasPrevPage ? encode(items[0].id) : null,
      },
    };
  }

  async findPageLastHistory(
    pageId: string,
    opts?: {
      includeContent?: boolean;
      trx?: KyselyTransaction;
    },
  ) {
    const db = dbOrTx(this.db, opts?.trx);

    return await db
      .selectFrom('pageHistory')
      .select(this.baseFields)
      .$if(opts?.includeContent, (qb) => qb.select('content'))
      .where('pageId', '=', pageId)
      .limit(1)
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  /** Caller holds the page lock and commits this in the same transaction as the edit. */
  async scheduleHistory(
    page: Pick<Page, 'id' | 'createdAt'>,
    contributorIds: string[],
    trx: KyselyTransaction,
    delay = historyDelay(page.createdAt),
  ) {
    await trx
      .insertInto('pageHistoryPending')
      .values({
        pageId: page.id,
        dueAt: new Date(Date.now() + delay),
        contributorIds,
      })
      .onConflict((oc) =>
        oc.column('pageId').doUpdateSet({
          dueAt: sql`least(page_history_pending.due_at, excluded.due_at)`,
          contributorIds: sql`ARRAY(SELECT DISTINCT unnest(page_history_pending.contributor_ids || excluded.contributor_ids))`,
        }),
      )
      .execute();
  }

  findDueHistory() {
    return this.db
      .selectFrom('pageHistoryPending')
      .select('pageId')
      .where('dueAt', '<=', sql<Date>`now()`)
      .orderBy('dueAt')
      .limit(50)
      .execute();
  }

  async savePendingHistory(pageId: string) {
    return this.db.transaction().execute(async (trx) => {
      // Always lock page before pending row, matching every writer. Other workers skip it.
      const page = await trx
        .selectFrom('pages')
        .selectAll()
        .where('id', '=', pageId)
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!page) return null;
      const pending = await trx
        .selectFrom('pageHistoryPending')
        .selectAll()
        .where('pageId', '=', pageId)
        .where('dueAt', '<=', sql<Date>`now()`)
        .forUpdate()
        .executeTakeFirst();
      if (!pending) return null;
      const last = await this.findPageLastHistory(pageId, {
        includeContent: true,
        trx,
      });
      // Snapshot and acknowledgement are one commit. Failed writes leave the job intact.
      if (!sameHistoryState(last, page)) {
        await this.saveHistory(page, {
          contributorIds: pending.contributorIds,
          trx,
        });
      }
      await trx
        .deleteFrom('pageHistoryPending')
        .where('pageId', '=', pageId)
        .execute();
      return {
        spaceId: page.spaceId,
        workspaceId: page.workspaceId,
        contributorIds: pending.contributorIds,
      };
    });
  }

  async deferHistoryRetry(pageId: string, reason: string) {
    await this.db
      .updateTable('pageHistoryPending')
      .set({
        attempts: sql`attempts + 1`,
        lastError: String(reason ?? 'UnknownError').slice(0, 100),
        dueAt: sql`now() + least(3600, 20 * power(2, least(attempts, 8))) * interval '1 second'`,
      })
      .where('pageId', '=', pageId)
      .execute();
  }

  async getHistoryStatus(pageId: string) {
    const pending = await this.db
      .selectFrom('pageHistoryPending')
      .select(['dueAt', 'attempts'])
      .where('pageId', '=', pageId)
      .executeTakeFirst();
    return {
      pending: !!pending,
      dueAt: pending?.dueAt ?? null,
      retrying: (pending?.attempts ?? 0) > 0,
    };
  }

  withLastUpdatedBy(eb: ExpressionBuilder<DB, 'pageHistory'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('users')
        .select(['users.id', 'users.name', 'users.avatarUrl'])
        .whereRef('users.id', '=', 'pageHistory.lastUpdatedById'),
    ).as('lastUpdatedBy');
  }

  withContributors(eb: ExpressionBuilder<DB, 'pageHistory'>) {
    return jsonArrayFrom(
      eb
        .selectFrom('users')
        .select(['users.id', 'users.name', 'users.avatarUrl'])
        .whereRef(
          'users.id',
          '=',
          sql`ANY(${eb.ref('pageHistory.contributorIds')})`,
        ),
    ).as('contributors');
  }
}
