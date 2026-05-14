import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { EnvironmentService } from '../../integrations/environment/environment.service';

const ALGORITHM = 'aes-256-gcm';
const PAYLOAD_PREFIX = 'wlenc:v1:';
const AAD = Buffer.from('wrenlore:app-secret-encryption:v1');
const SALT = Buffer.from('wrenlore:app-secret-encryption:salt:v1');
const INFO = Buffer.from('wrenlore:app-secret-encryption:key:v1');

interface EncryptedPayload {
  v: 1;
  alg: typeof ALGORITHM;
  iv: string;
  tag: string;
  ciphertext: string;
}

@Injectable()
export class AppSecretCryptoService {
  constructor(private readonly environmentService: EnvironmentService) {}

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.getKey(), iv);
    cipher.setAAD(AAD);

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const payload: EncryptedPayload = {
      v: 1,
      alg: ALGORITHM,
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
    };

    return `${PAYLOAD_PREFIX}${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  }

  decrypt(serializedPayload: string): string {
    if (!serializedPayload.startsWith(PAYLOAD_PREFIX)) {
      throw new Error('Unsupported encrypted payload format');
    }

    const payload = JSON.parse(
      Buffer.from(
        serializedPayload.slice(PAYLOAD_PREFIX.length),
        'base64url',
      ).toString('utf8'),
    ) as EncryptedPayload;

    if (payload.v !== 1 || payload.alg !== ALGORITHM) {
      throw new Error('Unsupported encrypted payload version');
    }

    const decipher = createDecipheriv(
      ALGORITHM,
      this.getKey(),
      Buffer.from(payload.iv, 'base64url'),
    );
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private getKey(): Buffer {
    return Buffer.from(
      hkdfSync(
        'sha256',
        Buffer.from(this.environmentService.getAppSecret(), 'utf8'),
        SALT,
        INFO,
        32,
      ),
    );
  }
}
