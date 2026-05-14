import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS vector;`.execute(db);
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Keep extension in place on rollback to avoid breaking dependent objects.
}
