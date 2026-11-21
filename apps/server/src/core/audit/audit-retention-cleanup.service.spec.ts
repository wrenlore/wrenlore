import { AuditRetentionCleanupService } from './audit-retention-cleanup.service';

describe('AuditRetentionCleanupService (#151)', () => {
  function fakeDb(workspaces: { id: string; auditRetentionDays: number | null }[]) {
    const deletes: { workspaceId: string; before: Date }[] = [];
    let pendingWhere: Record<string, unknown> = {};

    const deleteQuery = {
      where(col: string, op: string, val: unknown) {
        pendingWhere[col] = val;
        return deleteQuery;
      },
      async executeTakeFirst() {
        deletes.push({
          workspaceId: pendingWhere['workspaceId'] as string,
          before: pendingWhere['createdAt'] as Date,
        });
        pendingWhere = {};
        return { numDeletedRows: 3n };
      },
    };

    const db = {
      selectFrom: () => {
        const selectQuery = {
          select: () => selectQuery,
          where: () => selectQuery,
          execute: async () => workspaces,
        };
        return selectQuery;
      },
      deleteFrom: () => deleteQuery,
    };

    return { db: db as any, deletes };
  }

  it('deletes events older than the workspace retention', async () => {
    const { db, deletes } = fakeDb([{ id: 'ws-1', auditRetentionDays: 30 }]);
    const service = new AuditRetentionCleanupService(db);

    await service.cleanupExpiredAuditLogs();

    expect(deletes).toHaveLength(1);
    expect(deletes[0].workspaceId).toBe('ws-1');
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    expect(Math.abs(deletes[0].before.getTime() - cutoff.getTime())).toBeLessThan(
      60_000,
    );
  });

  it('keeps events for workspaces without a retention setting', async () => {
    const { db, deletes } = fakeDb([
      { id: 'ws-1', auditRetentionDays: null },
      { id: 'ws-2', auditRetentionDays: 0 },
    ]);
    const service = new AuditRetentionCleanupService(db);

    await service.cleanupExpiredAuditLogs();

    expect(deletes).toHaveLength(0);
  });
});
