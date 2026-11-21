import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Supports the audit retention cleanup deletes (workspace + created_at)
  // and time-range filters without a full table scan (#151).
  await db.schema
    .createIndex('idx_audit_workspace_created_at')
    .ifNotExists()
    .on('audit')
    .columns(['workspace_id', 'created_at desc'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('idx_audit_workspace_created_at')
    .ifExists()
    .execute();
}
