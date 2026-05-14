import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`drop table if exists user_mfa_recovery_codes`.execute(db);
  await sql`drop table if exists user_mfa`.execute(db);
  await sql`alter table workspaces drop column if exists enforce_mfa`.execute(
    db,
  );

  await db.schema
    .createTable('user_mfa')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    .addColumn('method', 'varchar', (col) => col.notNull().defaultTo('totp'))
    .addColumn('totp_secret', 'text', (col) => col)
    .addColumn('confirmed_at', 'timestamptz', (col) => col)
    .addColumn('enabled_at', 'timestamptz', (col) => col)
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('user_mfa_user_id_unique', ['user_id'])
    .execute();

  await db.schema
    .createTable('user_mfa_recovery_codes')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('user_mfa_id', 'uuid', (col) =>
      col.references('user_mfa.id').onDelete('cascade').notNull(),
    )
    .addColumn('code_hash', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('used_at', 'timestamptz', (col) => col)
    .addUniqueConstraint('user_mfa_recovery_codes_hash_unique', [
      'user_mfa_id',
      'code_hash',
    ])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('user_mfa_recovery_codes').execute();
  await db.schema.dropTable('user_mfa').execute();
}
