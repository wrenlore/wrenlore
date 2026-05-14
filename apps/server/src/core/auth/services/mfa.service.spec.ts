import { MfaService } from './mfa.service';
import * as OTPAuth from 'otpauth';

describe('MfaService', () => {
  const cryptoService = {
    encrypt: jest.fn((value: string) => `encrypted:${value}`),
    decrypt: jest.fn((value: string) => value.replace(/^encrypted:/, '')),
  };
  let service: MfaService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MfaService(cryptoService as any);
  });

  it('generates TOTP setup data with encrypted secret material', () => {
    const setup = service.generateTotpSetupData('user@example.com');

    expect(setup.secret).toMatch(/^[A-Z2-7]+$/);
    expect(setup.uri).toContain('otpauth://totp/');
    expect(setup.uri).toContain('issuer=WrenLore');
    expect(setup.encryptedSecret).toBe(`encrypted:${setup.secret}`);
  });

  it('verifies valid TOTP tokens and rejects invalid tokens', () => {
    const setup = service.generateTotpSetupData('user@example.com');
    const secret = service.decryptTotpSecret(setup.encryptedSecret);
    const token = OTPAuth.TOTP.generate({
      secret: OTPAuth.Secret.fromBase32(setup.secret),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
    const invalidToken = `${token.slice(0, -1)}${
      token.endsWith('0') ? '1' : '0'
    }`;

    expect(secret).toBe(setup.secret);
    expect(service.verifyTotpToken(setup.secret, token)).toBe(true);
    expect(service.verifyTotpToken(setup.secret, invalidToken)).toBe(false);
  });

  it('generates recovery codes and stores only hashes', async () => {
    const [code] = service.generateRecoveryCodes(1);
    const hash = await service.hashRecoveryCode(code);

    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){3}$/);
    expect(hash).not.toContain(code);
    expect(await service.verifyRecoveryCode(code, hash)).toBe(true);
    expect(await service.verifyRecoveryCode('WRONG-CODE', hash)).toBe(false);
  });

  it('finds only unused matching recovery codes and represents consumption', async () => {
    const usedCode = service.generateRecoveryCodes(1)[0];
    const unusedCode = service.generateRecoveryCodes(1)[0];
    const usedHash = await service.hashRecoveryCode(usedCode);
    const unusedHash = await service.hashRecoveryCode(unusedCode);

    const match = await service.findMatchingRecoveryCode(unusedCode, [
      { id: 'used', codeHash: usedHash, usedAt: new Date() },
      { id: 'unused', codeHash: unusedHash, usedAt: null },
    ]);

    expect(match?.id).toBe('unused');
    expect(service.consumeRecoveryCode(match!).usedAt).toBeInstanceOf(Date);
    await expect(
      service.findMatchingRecoveryCode(usedCode, [
        { id: 'used', codeHash: usedHash, usedAt: new Date() },
      ]),
    ).resolves.toBeNull();
  });
});
