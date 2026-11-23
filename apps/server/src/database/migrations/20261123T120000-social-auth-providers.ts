import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // `auth_providers.type` is a text column (the original enum was dropped by
  // the LDAP migration), so adding the social provider types needs no schema
  // change — only the constraints that back the social login invariants.

  // One GitHub and one Google configuration per workspace.
  await db.schema
    .createIndex('auth_providers_workspace_social_type_unique')
    .unique()
    .on('auth_providers')
    .columns(['workspace_id', 'type'])
    .where(sql<boolean>`deleted_at is null`)
    .where(sql<boolean>`type in ('github', 'google')`)
    .execute();

  // A provider identity can only be linked to one account per workspace.
  // This backs the concurrent-callback protection in the social login flow;
  // the SAML flow already relies on this invariant in application code.
  await db.schema
    .createIndex('auth_accounts_provider_identity_unique')
    .unique()
    .on('auth_accounts')
    .columns(['workspace_id', 'auth_provider_id', 'provider_user_id'])
    .where(sql<boolean>`deleted_at is null`)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('auth_accounts_provider_identity_unique')
    .execute();
  await db.schema
    .dropIndex('auth_providers_workspace_social_type_unique')
    .execute();
}
