import { AppSecretCryptoService } from './app-secret-crypto.service';

describe('AppSecretCryptoService', () => {
  const createService = (appSecret = 'a'.repeat(32)) =>
    new AppSecretCryptoService({
      getAppSecret: () => appSecret,
    } as any);

  it('encrypts and decrypts payloads using APP_SECRET-derived keys', () => {
    const service = createService();

    const encrypted = service.encrypt('totp-secret');

    expect(encrypted).toMatch(/^wlenc:v1:/);
    expect(encrypted).not.toContain('totp-secret');
    expect(service.decrypt(encrypted)).toBe('totp-secret');
  });

  it('fails when ciphertext is tampered', () => {
    const service = createService();
    const encrypted = service.encrypt('totp-secret');
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith('A') ? 'B' : 'A'}`;

    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('fails when a different APP_SECRET is used', () => {
    const encrypted = createService('a'.repeat(32)).encrypt('totp-secret');

    expect(() => createService('b'.repeat(32)).decrypt(encrypted)).toThrow();
  });
});
