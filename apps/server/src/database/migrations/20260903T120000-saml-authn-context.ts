import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('auth_providers')
    .addColumn('requested_authn_context_mode', 'varchar', (col) =>
      col.notNull().defaultTo('legacy-default'),
    )
    .addColumn('requested_authn_context_class_refs', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn('requested_authn_context_comparison', 'varchar', (col) =>
      col.notNull().defaultTo('exact'),
    )
    .execute();

  await sql`
    alter table auth_providers
      add constraint auth_providers_requested_authn_context_mode_check
        check (requested_authn_context_mode in ('omit', 'explicit', 'legacy-default')),
      add constraint auth_providers_requested_authn_context_comparison_check
        check (requested_authn_context_comparison in ('exact', 'minimum', 'maximum', 'better')),
      add constraint auth_providers_requested_authn_context_refs_check
        check (jsonb_typeof(requested_authn_context_class_refs) = 'array')
  `.execute(db);

  // SAML was originally presented as an Entra-only integration. Preserve the
  // library default for generic/ambiguous providers, while migrating providers
  // that are clearly Entra from their name or Microsoft identity endpoints.
  await db
    .updateTable('auth_providers')
    .set({ requested_authn_context_mode: 'omit' })
    .where('type', '=', 'saml')
    .where((eb) =>
      eb.or([
        eb(sql`lower(name)`, 'in', [
          'entra id',
          'microsoft entra id',
          'azure ad',
          'azure active directory',
        ]),
        eb(
          sql`lower(coalesce(saml_url, ''))`,
          'like',
          'https://login.microsoftonline.com/%',
        ),
        eb(
          sql`lower(coalesce(saml_url, ''))`,
          'like',
          'https://login.microsoftonline.us/%',
        ),
        eb(
          sql`lower(coalesce(saml_url, ''))`,
          'like',
          'https://login.partner.microsoftonline.cn/%',
        ),
        eb(
          sql`lower(coalesce(saml_url, ''))`,
          'like',
          'https://login.chinacloudapi.cn/%',
        ),
        eb(
          sql`lower(coalesce(idp_entity_id, ''))`,
          'like',
          'https://sts.windows.net/%',
        ),
      ]),
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('auth_providers')
    .dropColumn('requested_authn_context_comparison')
    .dropColumn('requested_authn_context_class_refs')
    .dropColumn('requested_authn_context_mode')
    .execute();
}
