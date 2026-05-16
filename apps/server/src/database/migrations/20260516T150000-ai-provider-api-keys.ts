import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_providers')
    .addColumn('encrypted_api_key', 'text')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_providers')
    .dropColumn('encrypted_api_key')
    .execute();
}
