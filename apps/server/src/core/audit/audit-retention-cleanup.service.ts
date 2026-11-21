import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@wrenlore/db/types/kysely.types';

/**
 * Enforces the per-workspace audit retention setting (#151).
 *
 * `workspaces.auditRetentionDays` was previously stored and displayed but
 * never applied, so the audit table grew without bound. Rows older than the
 * workspace retention are deleted once a day. Workspaces without a retention
 * value keep their events indefinitely.
 */
@Injectable()
export class AuditRetentionCleanupService {
  private readonly logger = new Logger(AuditRetentionCleanupService.name);

  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  @Interval('audit-retention-cleanup', 24 * 60 * 60 * 1000)
  async cleanupExpiredAuditLogs() {
    try {
      const workspaces = await this.db
        .selectFrom('workspaces')
        .select(['id', 'auditRetentionDays'])
        .where('deletedAt', 'is', null)
        .execute();

      for (const workspace of workspaces) {
        const retentionDays = workspace.auditRetentionDays;
        if (!retentionDays || retentionDays < 1) continue;

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - retentionDays);

        const deleted = await this.db
          .deleteFrom('audit')
          .where('workspaceId', '=', workspace.id)
          .where('createdAt', '<', cutoff)
          .executeTakeFirst();

        const count = Number(deleted?.numDeletedRows ?? 0);
        if (count > 0) {
          this.logger.log(
            `Audit retention: removed ${count} event(s) older than ${retentionDays} day(s)`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        'Audit retention cleanup job failed',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
