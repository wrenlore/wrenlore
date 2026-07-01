import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE ai_providers ADD COLUMN IF NOT EXISTS encrypted_api_key text`.execute(
    db,
  );
}

export async function down(_db: Kysely<any>): Promise<void> {
  // No-op: encrypted_api_key is owned by the base AI platform migration.
}
