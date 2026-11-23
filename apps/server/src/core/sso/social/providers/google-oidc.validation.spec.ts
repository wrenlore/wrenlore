// Exercise openid-client itself with locally signed ID tokens and mock HTTP endpoints.
import { createServer, Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { AddressInfo } from 'node:net';
import * as jwt from 'jsonwebtoken';
import { Issuer } from 'openid-client';
import { GoogleOidcProvider } from './google-oidc.provider';

describe('Google OIDC token validation through real openid-client', () => {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let server: Server;
  let base: string;
  let idToken: string;
  let tokenRequest: URLSearchParams;
  let provider: GoogleOidcProvider;

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/jwks') {
        res.end(
          JSON.stringify({
            keys: [
              {
                ...key.publicKey.export({ format: 'jwk' }),
                use: 'sig',
                alg: 'RS256',
                kid: 'test-key',
              },
            ],
          }),
        );
        return;
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      tokenRequest = new URLSearchParams(body);
      res.end(
        JSON.stringify({
          access_token: 'discard-after-resolution',
          token_type: 'Bearer',
          id_token: idToken,
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(() => {
    provider = new GoogleOidcProvider();
    jest.spyOn(provider, 'ensureIssuer').mockResolvedValue(
      new Issuer({
        issuer: 'https://accounts.google.com',
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        jwks_uri: `${base}/jwks`,
        id_token_signing_alg_values_supported: ['RS256'],
      }),
    );
  });
  const request = {
    clientId: 'test-client',
    clientSecret: 'test-secret',
    redirectUri: 'https://app.example.com/callback',
    code: 'test-code',
    state: 'test-state',
    nonce: 'test-nonce',
    codeVerifier: 'a'.repeat(43),
  };
  function sign(
    overrides: Record<string, unknown> = {},
    signingKey = key.privateKey,
  ) {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      {
        iss: 'https://accounts.google.com',
        aud: 'test-client',
        sub: 'stable-sub',
        iat: now,
        exp: now + 300,
        nonce: 'test-nonce',
        email: 'person@example.com',
        email_verified: true,
        ...overrides,
      },
      signingKey,
      { algorithm: 'RS256', keyid: 'test-key' },
    );
  }
  it('accepts a valid signed token, sends PKCE, and returns identity fields only', async () => {
    idToken = sign();
    const result = await provider.resolveIdentity(request);
    expect(result).toMatchObject({
      providerUserId: 'stable-sub',
      emailVerified: true,
    });
    expect(tokenRequest.get('code_verifier')).toBe(request.codeVerifier);
    expect(JSON.stringify(result)).not.toContain(idToken);
    expect(JSON.stringify(result)).not.toContain('discard-after-resolution');
  });
  it.each([
    ['issuer', { iss: 'https://untrusted.example' }],
    ['audience', { aud: 'another-client' }],
    ['expiry', { exp: 1 }],
    ['nonce', { nonce: 'another-flow' }],
  ])('rejects invalid %s claims', async (_name, claims) => {
    idToken = sign(claims as Record<string, unknown>);
    await expect(provider.resolveIdentity(request)).rejects.toThrow(
      'Google identity response rejected.',
    );
  });
  it('rejects a token signed with an untrusted key', async () => {
    idToken = sign({}, otherKey.privateKey);
    await expect(provider.resolveIdentity(request)).rejects.toThrow(
      'Google identity response rejected.',
    );
  });
});
