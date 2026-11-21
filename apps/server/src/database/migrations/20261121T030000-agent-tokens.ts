import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('api_keys')
    .addColumn('token_hash', 'text')
    .addColumn('agent_name', 'text')
    .addColumn('access', 'text', (c) => c.notNull().defaultTo('read'))
    .addColumn('space_ids', sql`uuid[]`)
    .execute();
  await db.schema
    .createTable('agent_operations')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('token_id', 'uuid', (c) =>
      c.notNull().references('api_keys.id').onDelete('cascade'),
    )
    .addColumn('workspace_id', 'uuid', (c) =>
      c.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('request_key', 'text', (c) => c.notNull())
    .addColumn('request_hash', 'text', (c) => c.notNull())
    .addColumn('tool', 'text', (c) => c.notNull())
    .addColumn('result', 'jsonb')
    .addColumn('created_at', 'timestamptz', (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('agent_operations_request_unique', [
      'token_id',
      'request_key',
    ])
    .execute();
  for (const table of ['comments', 'page_history']) {
    await db.schema.alterTable(table).addColumn('agent_name', 'text').execute();
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const table of ['comments', 'page_history']) {
    await db.schema.alterTable(table).dropColumn('agent_name').execute();
  }
  await db.schema.dropTable('agent_operations').execute();
  await db.schema
    .alterTable('api_keys')
    .dropColumn('token_hash')
    .dropColumn('agent_name')
    .dropColumn('access')
    .dropColumn('space_ids')
    .execute();
}
