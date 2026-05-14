import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '@wrenlore/db/types/kysely.types';

export const MFA_POLICY_SETTING_KEY = 'mfa_policy';

@Injectable()
export class InstanceSettingRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async isLocalMfaRequired(): Promise<boolean> {
    const row = await this.db
      .selectFrom('instanceSettings')
      .select('value')
      .where('key', '=', MFA_POLICY_SETTING_KEY)
      .executeTakeFirst();

    return row?.value?.['requireForLocalAccounts'] === true;
  }

  async setLocalMfaRequired(requireForLocalAccounts: boolean) {
    return this.db
      .insertInto('instanceSettings')
      .values({
        key: MFA_POLICY_SETTING_KEY,
        value: { requireForLocalAccounts },
      })
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({
          value: sql`excluded.value`,
          updatedAt: new Date(),
        }),
      )
      .returningAll()
      .executeTakeFirst();
  }
}
