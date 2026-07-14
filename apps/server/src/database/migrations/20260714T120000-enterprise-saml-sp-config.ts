import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('auth_providers')
    .addColumn('sp_entity_id', 'varchar')
    .addColumn('sp_acs_url', 'varchar')
    .addColumn('sp_acs_url_key', 'varchar')
    .addColumn('sp_acs_binding', 'varchar')
    .addColumn('sp_slo_url', 'varchar')
    .addColumn('name_id_format', 'varchar')
    .addColumn('sp_acs_path', 'varchar')
    .addColumn('idp_entity_id', 'varchar')
    .addColumn('idp_slo_url', 'varchar')
    .execute();

  await db.schema
    .createIndex('auth_providers_sp_acs_url_key_unique')
    .unique()
    .on('auth_providers')
    .column('sp_acs_url_key')
    .where(sql<boolean>`deleted_at is null`)
    .execute();

  await db.schema
    .createIndex('auth_providers_sp_acs_path_idx')
    .on('auth_providers')
    .column('sp_acs_path')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('auth_providers_sp_acs_path_idx')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('auth_providers_sp_acs_url_key_unique')
    .ifExists()
    .execute();

  await db.schema
    .alterTable('auth_providers')
    .dropColumn('idp_slo_url')
    .dropColumn('idp_entity_id')
    .dropColumn('sp_acs_path')
    .dropColumn('name_id_format')
    .dropColumn('sp_slo_url')
    .dropColumn('sp_acs_binding')
    .dropColumn('sp_acs_url_key')
    .dropColumn('sp_acs_url')
    .dropColumn('sp_entity_id')
    .execute();
}
