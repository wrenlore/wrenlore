import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createType('ai_provider_type')
    .asEnum(['openai', 'openai-compatible', 'ollama'])
    .execute();

  await db.schema
    .createType('ai_task_class')
    .asEnum([
      'text-generation',
      'streaming-generation',
      'grounded-answer-generation',
      'embeddings-indexing-preparation',
    ])
    .execute();

  await db.schema
    .createTable('ai_providers')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('type', sql`ai_provider_type`, (col) => col.notNull())
    .addColumn('base_url', 'varchar')
    .addColumn('api_key_env_var', 'varchar')
    .addColumn('encrypted_api_key', 'text')
    .addColumn('is_enabled', 'boolean', (col) =>
      col.defaultTo(true).notNull(),
    )
    .addColumn('capability_flags', 'jsonb', (col) =>
      col.defaultTo(sql`'{}'::jsonb`).notNull(),
    )
    .addColumn('creator_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .addUniqueConstraint('ai_providers_workspace_name_unique', [
      'workspace_id',
      'name',
    ])
    .execute();

  await db.schema
    .createIndex('ai_providers_workspace_id_idx')
    .on('ai_providers')
    .column('workspace_id')
    .execute();

  await db.schema
    .createTable('ai_models')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('model_id', 'varchar', (col) => col.notNull())
    .addColumn('is_enabled', 'boolean', (col) =>
      col.defaultTo(true).notNull(),
    )
    .addColumn('capability_flags', 'jsonb', (col) =>
      col.defaultTo(sql`'{}'::jsonb`).notNull(),
    )
    .addColumn('creator_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('provider_id', 'uuid', (col) =>
      col.references('ai_providers.id').onDelete('cascade').notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .addUniqueConstraint('ai_models_workspace_provider_name_unique', [
      'workspace_id',
      'provider_id',
      'name',
    ])
    .execute();

  await db.schema
    .createIndex('ai_models_workspace_id_idx')
    .on('ai_models')
    .column('workspace_id')
    .execute();

  await db.schema
    .createIndex('ai_models_provider_id_idx')
    .on('ai_models')
    .column('provider_id')
    .execute();

  await db.schema
    .createTable('ai_task_routes')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('task_class', sql`ai_task_class`, (col) => col.notNull())
    .addColumn('route_options', 'jsonb', (col) =>
      col.defaultTo(sql`'{}'::jsonb`).notNull(),
    )
    .addColumn('model_id', 'uuid', (col) =>
      col.references('ai_models.id').onDelete('cascade').notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('ai_task_routes_workspace_task_class_unique', [
      'workspace_id',
      'task_class',
    ])
    .execute();

  await db.schema
    .createIndex('ai_task_routes_workspace_id_idx')
    .on('ai_task_routes')
    .column('workspace_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('ai_task_routes').ifExists().execute();
  await db.schema.dropTable('ai_models').ifExists().execute();
  await db.schema.dropTable('ai_providers').ifExists().execute();

  await db.schema.dropType('ai_task_class').ifExists().execute();
  await db.schema.dropType('ai_provider_type').ifExists().execute();
}
