import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@wrenlore/db/types/kysely.types';
import { dbOrTx } from '@wrenlore/db/utils';

@Injectable()
export class UserMfaRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async insertTotpMfa(
    data: {
      userId: string;
      workspaceId: string;
      totpSecret: string;
    },
    trx?: KyselyTransaction,
  ) {
    return dbOrTx(this.db, trx)
      .insertInto('userMfa')
      .values({
        userId: data.userId,
        workspaceId: data.workspaceId,
        method: 'totp',
        totpSecret: data.totpSecret,
      })
      .returningAll()
      .executeTakeFirst();
  }

  async findByUserId(
    userId: string,
    workspaceId: string,
    opts?: { includeTotpSecret?: boolean; trx?: KyselyTransaction },
  ) {
    const db = dbOrTx(this.db, opts?.trx);

    return db
      .selectFrom('userMfa')
      .select([
        'id',
        'userId',
        'workspaceId',
        'method',
        'confirmedAt',
        'enabledAt',
        'createdAt',
        'updatedAt',
      ])
      .$if(opts?.includeTotpSecret, (qb) => qb.select('totpSecret'))
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
  }

  async enableMfa(id: string, enabledAt = new Date(), trx?: KyselyTransaction) {
    return dbOrTx(this.db, trx)
      .updateTable('userMfa')
      .set({
        confirmedAt: enabledAt,
        enabledAt,
        updatedAt: enabledAt,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  async insertRecoveryCodeHashes(
    userMfaId: string,
    codeHashes: string[],
    trx?: KyselyTransaction,
  ) {
    if (codeHashes.length === 0) return [];

    return dbOrTx(this.db, trx)
      .insertInto('userMfaRecoveryCodes')
      .values(
        codeHashes.map((codeHash) => ({
          userMfaId,
          codeHash,
        })),
      )
      .returningAll()
      .execute();
  }

  async deleteRecoveryCodesByMfaId(
    userMfaId: string,
    trx?: KyselyTransaction,
  ) {
    return dbOrTx(this.db, trx)
      .deleteFrom('userMfaRecoveryCodes')
      .where('userMfaId', '=', userMfaId)
      .execute();
  }

  async markRecoveryCodeUsed(
    recoveryCodeId: string,
    usedAt = new Date(),
    trx?: KyselyTransaction,
  ) {
    return dbOrTx(this.db, trx)
      .updateTable('userMfaRecoveryCodes')
      .set({ usedAt })
      .where('id', '=', recoveryCodeId)
      .where('usedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
  }

  async deleteById(id: string, trx?: KyselyTransaction) {
    return dbOrTx(this.db, trx)
      .deleteFrom('userMfa')
      .where('id', '=', id)
      .execute();
  }
}
