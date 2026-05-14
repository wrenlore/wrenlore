import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { AppSecretCryptoService } from '../../../common/crypto/app-secret-crypto.service';

const RECOVERY_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export interface MfaRecoveryCodeRecord {
  id: string;
  codeHash: string;
  usedAt?: Date | null;
}

@Injectable()
export class MfaService {
  constructor(private readonly cryptoService: AppSecretCryptoService) {}

  generateTotpSetupData(
    label: string,
    issuer = 'WrenLore',
  ): { secret: string; uri: string; encryptedSecret: string } {
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    const totp = new OTPAuth.TOTP({
      issuer,
      label,
      secret: OTPAuth.Secret.fromBase32(secret),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });

    return {
      secret,
      uri: totp.toString(),
      encryptedSecret: this.cryptoService.encrypt(secret),
    };
  }

  verifyTotpToken(secret: string, token: string, window = 1): boolean {
    const delta = OTPAuth.TOTP.validate({
      token,
      secret: OTPAuth.Secret.fromBase32(secret),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      window,
    });

    return delta !== null;
  }

  decryptTotpSecret(encryptedSecret: string): string {
    return this.cryptoService.decrypt(encryptedSecret);
  }

  generateRecoveryCodes(count = 10): string[] {
    return Array.from({ length: count }, () => this.generateRecoveryCode());
  }

  async hashRecoveryCode(code: string): Promise<string> {
    return bcrypt.hash(this.normalizeRecoveryCode(code), 12);
  }

  async hashRecoveryCodes(codes: string[]): Promise<string[]> {
    return Promise.all(codes.map((code) => this.hashRecoveryCode(code)));
  }

  async verifyRecoveryCode(code: string, codeHash: string): Promise<boolean> {
    return bcrypt.compare(this.normalizeRecoveryCode(code), codeHash);
  }

  async findMatchingRecoveryCode(
    code: string,
    records: MfaRecoveryCodeRecord[],
  ): Promise<MfaRecoveryCodeRecord | null> {
    for (const record of records) {
      if (record.usedAt) continue;
      if (await this.verifyRecoveryCode(code, record.codeHash)) {
        return record;
      }
    }

    return null;
  }

  consumeRecoveryCode<T extends MfaRecoveryCodeRecord>(
    record: T,
    usedAt = new Date(),
  ): T & { usedAt: Date } {
    return { ...record, usedAt };
  }

  private generateRecoveryCode(): string {
    const chars = Array.from(
      { length: 16 },
      () => RECOVERY_CODE_ALPHABET[randomInt(RECOVERY_CODE_ALPHABET.length)],
    );

    return chars.join('').replace(/(.{4})(?=.)/g, '$1-');
  }

  private normalizeRecoveryCode(code: string): string {
    return code.trim().toUpperCase();
  }
}
