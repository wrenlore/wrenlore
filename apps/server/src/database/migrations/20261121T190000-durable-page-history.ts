import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('page_history_pending')
    .addColumn('page_id', 'uuid', (c) =>
      c.primaryKey().references('pages.id').onDelete('cascade'),
    )
    .addColumn('due_at', 'timestamptz', (c) => c.notNull())
    .addColumn('contributor_ids', sql`uuid[]`, (c) =>
      c.notNull().defaultTo('{}'),
    )
    .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('last_error', 'varchar')
    .execute();
  await db.schema
    .createIndex('page_history_pending_due_idx')
    .on('page_history_pending')
    .column('due_at')
    .execute();
  await db.schema
    .createIndex('page_history_page_created_idx')
    .on('page_history')
    .columns(['page_id', 'created_at', 'id'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('page_history_page_created_idx').execute();
  await db.schema.dropTable('page_history_pending').execute();
}
