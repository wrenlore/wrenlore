import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '@wrenlore/db/types/kysely.types';

export const MFA_POLICY_SETTING_KEY = 'mfa_policy';

export type MfaPolicy = {
  enabled: boolean;
  requireForLocalAccounts: boolean;
};

export const DEFAULT_MFA_POLICY: MfaPolicy = {
  enabled: true,
  requireForLocalAccounts: false,
};

@Injectable()
export class InstanceSettingRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async getMfaPolicy(): Promise<MfaPolicy> {
    const row = await this.db
      .selectFrom('instanceSettings')
      .select('value')
      .where('key', '=', MFA_POLICY_SETTING_KEY)
      .executeTakeFirst();

    return {
      enabled: row?.value?.['enabled'] !== false,
      requireForLocalAccounts:
        row?.value?.['requireForLocalAccounts'] === true,
    };
  }

  async isLocalMfaRequired(): Promise<boolean> {
    const policy = await this.getMfaPolicy();
    return policy.enabled && policy.requireForLocalAccounts;
  }

  async isMfaEnabled(): Promise<boolean> {
    const policy = await this.getMfaPolicy();
    return policy.enabled;
  }

  async setMfaPolicy(policy: MfaPolicy) {
    return this.db
      .insertInto('instanceSettings')
      .values({
        key: MFA_POLICY_SETTING_KEY,
        value: policy,
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
