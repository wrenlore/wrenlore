import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Keep this idempotent for existing dev databases upgraded in place.
  await sql`CREATE EXTENSION IF NOT EXISTS vector;`.execute(db);

  await db.schema
    .createTable('page_embeddings')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('cascade').notNull(),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('model_name', 'varchar', (col) => col.notNull())
    .addColumn('model_dimensions', 'int4', (col) => col.notNull())
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('attachment_id', 'uuid', (col) =>
      col.references('attachments.id').onDelete('set null'),
    )
    .addColumn('embedding', sql`vector`, (col) => col.notNull())
    .addColumn('chunk_index', 'int4', (col) => col.notNull().defaultTo(0))
    .addColumn('chunk_start', 'int4', (col) => col.notNull().defaultTo(0))
    .addColumn('chunk_length', 'int4', (col) => col.notNull().defaultTo(0))
    .addColumn('metadata', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('page_embeddings_workspace_id_idx')
    .ifNotExists()
    .on('page_embeddings')
    .column('workspace_id')
    .execute();

  await db.schema
    .createIndex('page_embeddings_page_id_idx')
    .ifNotExists()
    .on('page_embeddings')
    .column('page_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('page_embeddings_page_id_idx')
    .ifExists()
    .execute();

  await db.schema
    .dropIndex('page_embeddings_workspace_id_idx')
    .ifExists()
    .execute();

  await db.schema.dropTable('page_embeddings').ifExists().execute();
}
